/**
 * The standard forms (PRD P1-11): every active form_definitions row, to download as a printable file or
 * fill in online, and the person's saved forms. Adding a definition adds it here with no code changes.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FileTextIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { FormAnswers, FormFields, PdfButton, useFormDefinition } from '../components/FormFields.tsx';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import type { Json } from '../lib/database.types.ts';
import { formProblems, type FormData } from '../lib/forms.ts';
import { businessRegistrationFormKey } from '../lib/queries.ts';
import { errorMessage, supabase } from '../lib/supabase.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

const printableLinkLifetimeSeconds = 60;
const audienceLabels = { business: 'For businesses', supplier: 'For suppliers' } as const;

export function FormsPage() {
  const { session, businessProfile, supplierProfile } = useAccount();
  // Only the forms the person's own accounts may fill in; the database refuses the others.
  const audiences = (Object.keys(audienceLabels) as (keyof typeof audienceLabels)[]).filter((audience) => (audience === 'business' ? businessProfile : supplierProfile) !== null);
  const [problem, setProblem] = useState<string | null>(null);
  const formsQuery = useQuery({
    queryKey: ['form-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('form_definitions').select('key, version, title, audience, is_draft, download_path').eq('is_active', true).order('title');
      if (error) throw error;
      // The newest active version of each form.
      return data.filter((form) => !data.some((other) => other.key === form.key && other.version > form.version));
    },
  });
  const savedQuery = useQuery({
    queryKey: ['own-forms', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('form_submissions').select('id, form_key, attached_to_type, updated_at').eq('owner_id', session?.user.id ?? '').order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function downloadPrintable(path: string) {
    setProblem(null);
    const { data, error } = await supabase.storage.from('form-templates').createSignedUrl(path, printableLinkLifetimeSeconds, { download: true });
    if (error) return setProblem(errorMessage(error));
    window.location.assign(data.signedUrl);
  }

  return (
    <>
      <PageHeader
        title="Forms"
        description="The standard forms for tenders and bids. Fill one in here and save it, or download it to print. Forms for a tender or a bid are also filled in from that tender or bid."
      />
      {formsQuery.isPending && <Loading />}
      {formsQuery.isError && <ErrorNotice error={formsQuery.error} />}
      {problem && <Notice tone="error">{problem}</Notice>}
      {audiences.map((audience) => {
        const forms = (formsQuery.data ?? []).filter((form) => form.audience === audience);
        if (forms.length === 0) return null;
        return (
          <section key={audience} className="mb-10">
            <h3 className="mb-3 text-sm font-semibold text-navy-dark">{audienceLabels[audience]}</h3>
            <ul className="grid gap-3 md:grid-cols-2">
              {forms.map((form) => (
                <li key={form.key} className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-surface">
                  <div className="flex items-start gap-3">
                    <FileTextIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="font-medium text-ink">{form.title}</p>
                      {form.is_draft && <p className="mt-0.5 text-xs text-muted-foreground">Draft, to be replaced by the client's form</p>}
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link to={`/forms/${form.key}`}>Fill in online</Link>
                    </Button>
                    {form.download_path && (
                      <Button size="sm" variant="outline" type="button" onClick={() => void downloadPrintable(form.download_path ?? '')}>
                        Download (Word)
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-navy-dark">My saved forms</h3>
        <div className="rounded-xl bg-card shadow-surface">
          {savedQuery.data?.length === 0 && <p className="p-5 text-sm text-muted-foreground">None yet. Forms you save appear here, so you can finish or reuse them.</p>}
          <ul className="divide-y">
            {(savedQuery.data ?? []).map((saved) => (
              <li key={saved.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
                <Link to={`/forms/${saved.form_key}?submission=${saved.id}`} className="font-medium text-navy-dark">
                  {formsQuery.data?.find((form) => form.key === saved.form_key)?.title ?? saved.form_key}
                </Link>
                <span className="text-sm text-muted-foreground">
                  Saved {formatJamaicaDateTime(saved.updated_at)}{saved.attached_to_type ? `, attached to a ${saved.attached_to_type}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

/**
 * Fills in one form. With ?tender=<draft id> it becomes that draft's requirements form; with
 * ?submission=<id> it edits a saved form. Forms attached to a published tender or a bid are locked.
 */
export function FormFillPage() {
  const formKey = useParams().formKey ?? '';
  const [searchParameters] = useSearchParams();
  const tenderId = searchParameters.get('tender');
  const submissionId = searchParameters.get('submission');
  // The business pages send an unregistered business here; it must complete the form to go on (Rockell, 22 Nov 2026).
  const isRequiredRegistration = formKey === businessRegistrationFormKey && searchParameters.has('required');
  const { session } = useAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [data, setData] = useState<FormData | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const existingQuery = useQuery({
    queryKey: ['form-submission', formKey, tenderId, submissionId, isRequiredRegistration],
    queryFn: async () => {
      let request = supabase.from('form_submissions').select('id, form_version, data, attached_to_type, attached_to_id').eq('form_key', formKey).eq('owner_id', session?.user.id ?? '');
      if (submissionId) request = request.eq('id', submissionId);
      else if (tenderId) request = request.eq('attached_to_type', 'tender').eq('attached_to_id', tenderId);
      // Picks up a registration form saved earlier but not finished, so its answers aren't lost.
      else if (isRequiredRegistration) request = request.is('attached_to_type', null).order('updated_at', { ascending: false }).limit(1);
      else return null;
      const { data: found, error } = await request.maybeSingle();
      if (error) throw error;
      if (found?.attached_to_type !== 'tender') return found ? { ...found, isOnPublishedTender: false } : null;
      // The database freezes a tender's form once the tender is published; lock it on screen too.
      const tender = await supabase.from('tenders').select('status').eq('id', found.attached_to_id ?? '').maybeSingle();
      if (tender.error) throw tender.error;
      return { ...found, isOnPublishedTender: tender.data !== null && tender.data.status !== 'draft' };
    },
  });
  // A saved form opens with the version it was saved under, so none of its answers are hidden.
  const definitionQuery = useFormDefinition(formKey, existingQuery.data?.form_version);

  if (definitionQuery.isPending || existingQuery.isPending) return <Loading />;
  if (definitionQuery.isError) return <ErrorNotice error={definitionQuery.error} />;
  if (existingQuery.isError) return <ErrorNotice error={existingQuery.error} />;
  const definition = definitionQuery.data;
  const existing = existingQuery.data;
  if (!definition) {
    if (!existing) return <Notice tone="error">This form isn't available.</Notice>;
    const savedAnswers = existing.data as FormData;
    return <>
      <PageHeader title={formKey} description="Saved answers from a retired form." back={{ to: '/forms', label: 'All forms' }} />
      <FormAnswers schema={{ fields: [] }} data={savedAnswers} />
      <PdfButton title={formKey} schema={{ fields: [] }} data={savedAnswers} fileName={`${formKey}.pdf`} />
    </>;
  }
  const isLocked = existing?.attached_to_type === 'bid' || existing?.isOnPublishedTender === true;

  const current: FormData = data ?? ((existing?.data ?? {}) as FormData);

  async function save() {
    setOutcome(null);
    // A Tender Creation Form can be saved half-finished and completed later; Publish checks it is complete.
    const found = formProblems(definition?.parsedSchema ?? { fields: [] }, current, isRequiredRegistration);
    setProblems(found);
    if (found.length > 0) return;
    setIsSaving(true);
    try {
      const saved = existing
        ? await supabase.from('form_submissions').update({ data: current as Json }).eq('id', existing.id).select('id').maybeSingle()
        : await supabase
            .from('form_submissions')
            .insert({
              form_key: formKey,
              form_version: definition?.version ?? 1,
              owner_id: session?.user.id ?? '',
              data: current as Json,
              ...(tenderId ? { attached_to_type: 'tender', attached_to_id: tenderId } : {}),
            })
            .select('id')
            .maybeSingle();
      if (saved.error) return setOutcome({ tone: 'error', text: errorMessage(saved.error) });
      if (!saved.data) return setOutcome({ tone: 'error', text: "The form wasn't saved: it may have been locked or removed. Reload the page and try again." });
      await queryClient.invalidateQueries({ queryKey: ['form-submission'] });
      await queryClient.invalidateQueries({ queryKey: ['own-forms'] });
      if (formKey === businessRegistrationFormKey) {
        // 'all': no business page is open to refetch it, and its cached "not registered" would send the business back here.
        await queryClient.invalidateQueries({ queryKey: ['business-registration'], refetchType: 'all' });
      }
      if (tenderId) {
        await queryClient.invalidateQueries({ queryKey: ['tender', tenderId] });
        void navigate(`/business/tenders/${tenderId}/edit`);
        return;
      }
      if (isRequiredRegistration) {
        void navigate('/business');
        return;
      }
      // The address now names the saved form, so the next Save updates it instead of making a copy.
      if (!existing) void navigate(`/forms/${formKey}?submission=${saved.data.id}`, { replace: true });
      setOutcome({ tone: 'success', text: 'Form saved.' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={definition.title}
        description={tenderId ? 'Fill in the requirements for your draft tender. You can save and come back to it; every required answer is needed before you publish.' : 'Fill it in and save it to come back later, or download it as a PDF.'}
        back={tenderId ? { to: `/business/tenders/${tenderId}/edit`, label: 'Back to your draft' } : { to: '/forms', label: 'All forms' }}
      />
      {tenderId && <Notice>This becomes the Tender Creation Form of your draft tender. It is locked once the tender is published.</Notice>}
      {isRequiredRegistration && <Notice>Complete your Business Registration Form to start posting tenders. You only need to do this once.</Notice>}
      {isLocked && <Notice>This form is attached to {existing?.attached_to_type === 'bid' ? 'a submitted bid' : 'a published tender'} and can't be changed.</Notice>}
      <Card className="max-w-3xl">
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            noValidate
          >
            {/* Only here to lock every field at once; min-w-0 stops a wide table stretching it past the card instead of scrolling. */}
            <fieldset disabled={isLocked} className="min-w-0">
              {isLocked
                ? <FormAnswers schema={definition.parsedSchema} data={current} />
                : <FormFields schema={definition.parsedSchema} data={current} onChange={setData} />}
            </fieldset>
            {problems.length > 0 && (
              <Notice tone="error">
                <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
              </Notice>
            )}
            {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
            <div className="flex flex-wrap items-center gap-2">
              {!isLocked && <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : tenderId ? 'Save and attach to the draft' : 'Save'}</Button>}
              <PdfButton title={definition.title} schema={definition.parsedSchema} data={current} fileName={`${formKey}.pdf`} />
              <Button asChild variant="outline">
                <Link to={tenderId ? `/business/tenders/${tenderId}/edit` : '/forms'}>Back</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
