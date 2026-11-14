/**
 * The standard forms (PRD P1-11): every active form_definitions row, to download as a printable file or
 * fill in online, and the person's saved forms. Adding a definition adds it here with no code changes.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { FormFields, PdfButton, useFormDefinition } from '../components/FormFields.tsx';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import type { Json } from '../lib/database.types.ts';
import { formProblems, type FormData } from '../lib/forms.ts';
import { errorMessage, supabase } from '../lib/supabase.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

const printableLinkLifetimeSeconds = 60;
const audienceLabels = { business: 'For businesses', supplier: 'For suppliers' } as const;

export function FormsPage() {
  const { session } = useAccount();
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
      <h2>Forms</h2>
      <div className="card">
        {formsQuery.isPending && <Loading />}
        {formsQuery.isError && <ErrorNotice error={formsQuery.error} />}
        {problem && <Notice tone="error">{problem}</Notice>}
        <ul className="links">
          {(formsQuery.data ?? []).map((form) => (
            <li key={form.key}>
              <strong>{form.title}</strong> <span className="small">{audienceLabels[form.audience]}{form.is_draft ? ' · draft, to be replaced by the client\'s form' : ''}</span>
              <div className="actions">
                <Link className="btn" to={`/forms/${form.key}`}>Fill in online</Link>
                {form.download_path && (
                  <button type="button" className="btn outline" onClick={() => void downloadPrintable(form.download_path ?? '')}>Download to print</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <h3>My saved forms</h3>
      <div className="card">
        {savedQuery.data?.length === 0 && <p className="small">None yet.</p>}
        <ul className="links">
          {(savedQuery.data ?? []).map((saved) => (
            <li key={saved.id}>
              <Link to={`/forms/${saved.form_key}?submission=${saved.id}`}>{formsQuery.data?.find((form) => form.key === saved.form_key)?.title ?? saved.form_key}</Link>{' '}
              <span className="small">saved {formatJamaicaDateTime(saved.updated_at)}{saved.attached_to_type ? ` · attached to a ${saved.attached_to_type}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
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
  const { session } = useAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const definitionQuery = useFormDefinition(formKey);
  const [data, setData] = useState<FormData | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const existingQuery = useQuery({
    queryKey: ['form-submission', formKey, tenderId, submissionId],
    queryFn: async () => {
      let request = supabase.from('form_submissions').select('id, form_version, data, attached_to_type').eq('form_key', formKey).eq('owner_id', session?.user.id ?? '');
      if (submissionId) request = request.eq('id', submissionId);
      else if (tenderId) request = request.eq('attached_to_type', 'tender').eq('attached_to_id', tenderId);
      else return null;
      const { data: found, error } = await request.maybeSingle();
      if (error) throw error;
      return found;
    },
  });

  if (definitionQuery.isPending || existingQuery.isPending) return <Loading />;
  if (definitionQuery.isError) return <ErrorNotice error={definitionQuery.error} />;
  if (existingQuery.isError) return <ErrorNotice error={existingQuery.error} />;
  const definition = definitionQuery.data;
  if (!definition) return <Notice tone="error">This form isn't available.</Notice>;
  const existing = existingQuery.data;
  const current: FormData = data ?? ((existing?.data ?? {}) as FormData);
  const isLocked = existing?.attached_to_type === 'bid';

  async function save() {
    setOutcome(null);
    const found = formProblems(definition?.parsedSchema ?? { fields: [] }, current, tenderId !== null);
    setProblems(found);
    if (found.length > 0) return;
    const saved = existing
      ? await supabase.from('form_submissions').update({ data: current as Json }).eq('id', existing.id)
      : await supabase.from('form_submissions').insert({
          form_key: formKey,
          form_version: definition?.version ?? 1,
          owner_id: session?.user.id ?? '',
          data: current as Json,
          ...(tenderId ? { attached_to_type: 'tender', attached_to_id: tenderId } : {}),
        });
    if (saved.error) return setOutcome({ tone: 'error', text: errorMessage(saved.error) });
    await queryClient.invalidateQueries({ queryKey: ['form-submission'] });
    await queryClient.invalidateQueries({ queryKey: ['own-forms'] });
    if (tenderId) {
      void navigate(`/business/tenders/${tenderId}/edit`);
      return;
    }
    setOutcome({ tone: 'success', text: 'Form saved.' });
  }

  return (
    <>
      <h2>{definition.title}</h2>
      {tenderId && <Notice>This becomes the requirements form of your draft tender. It is locked once the tender is published.</Notice>}
      {isLocked && <Notice>This form is attached to a submitted bid and can't be changed.</Notice>}
      <div className="card form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={isLocked}>
            <FormFields schema={definition.parsedSchema} data={current} onChange={setData} />
          </fieldset>
          {problems.length > 0 && (
            <Notice tone="error">
              <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </Notice>
          )}
          {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
          <div className="actions">
            {!isLocked && <button className="btn" type="submit">{tenderId ? 'Save and attach to the draft' : 'Save'}</button>}
            <PdfButton title={definition.title} schema={definition.parsedSchema} data={current} fileName={`${formKey}.pdf`} />
            <Link className="btn outline" to={tenderId ? `/business/tenders/${tenderId}/edit` : '/forms'}>Back</Link>
          </div>
        </form>
      </div>
    </>
  );
}
