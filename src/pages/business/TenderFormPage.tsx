/**
 * Create or edit a draft tender and its files (PRD P1-06). Drafts are fully editable; once published,
 * a tender is managed from its page, where only the closing time can be extended.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleIcon } from 'lucide-react';
import { useAccount } from '../../auth/AccountContext.tsx';
import { CategoryOptions } from '../../components/CategoryOptions.tsx';
import { useConfirmation } from '../../components/ConfirmDialog.tsx';
import { useFormDefinition } from '../../components/FormFields.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, NativeSelect, Textarea } from '../../components/ui/fields.tsx';
import { acceptedDocumentDescription, acceptedDocumentExtensions, checkDocument, draftUploadRule, tenderDocumentPath, uploadProblem } from '../../lib/documents.ts';
import { formProblems, type FormData } from '../../lib/forms.ts';
import { useCategories } from '../../lib/queries.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { jamaicaLocalToUtc, utcToJamaicaLocal } from '../../lib/time.ts';

// The same limits as the tenders table's checks.
const minimumTitleLength = 3;
const maximumTitleLength = 200;
const maximumDescriptionLength = 20_000;
const requirementsFolder = 'requirements-form';
const businessRequirementsFormKey = 'business-requirements';

const tenderSchema = z.object({
  title: z.string().trim().min(minimumTitleLength, `Use at least ${minimumTitleLength} characters.`).max(maximumTitleLength, `Use at most ${maximumTitleLength} characters.`),
  description: z.string().trim().min(1, 'Describe what you need.').max(maximumDescriptionLength, `Use at most ${maximumDescriptionLength} characters.`),
  categoryId: z.string().min(1, 'Choose a category.'),
  closesAtLocal: z
    .string()
    .min(1, 'Choose the closing date and time.')
    .refine((value) => {
      try {
        return new Date(jamaicaLocalToUtc(value)).getTime() > Date.now();
      } catch {
        return false;
      }
    }, 'Choose a closing time in the future (Jamaica time).'),
});
type TenderValues = z.infer<typeof tenderSchema>;

/** Files uploaded into a draft's folder so far: supporting documents, and the uploaded requirements form. */
export async function listDraftFiles(tenderId: string) {
  const bucket = supabase.storage.from('tender-documents');
  const [supporting, requirements] = await Promise.all([bucket.list(tenderId), bucket.list(`${tenderId}/${requirementsFolder}`)]);
  if (supporting.error) throw supporting.error;
  if (requirements.error) throw requirements.error;
  // Folders show up in a listing as entries without an id.
  const files = (entries: typeof supporting.data, folder: string) =>
    entries.filter((entry) => entry.id !== null).map((entry) => ({ name: entry.name, path: `${folder}/${entry.name}` }));
  return { supporting: files(supporting.data, tenderId), requirements: files(requirements.data, `${tenderId}/${requirementsFolder}`) };
}

function useDraftFiles(tenderId: string) {
  return useQuery({ queryKey: ['draft-files', tenderId], enabled: tenderId !== '', queryFn: () => listDraftFiles(tenderId) });
}

/** The publish confirmation, shared by the draft page and the tender page. */
export const publishConfirmation = {
  title: 'Publish this tender?',
  message: 'Suppliers can see it and bid, and those in its category get an email. After publishing you can only extend the closing time or cancel it.',
  confirmLabel: 'Publish',
  cancelLabel: 'Not yet',
  tone: 'go-ahead',
} as const;

/**
 * What is left before a draft can be published, with the Publish button, so a business can't mistake a
 * saved draft for a live tender (Rockell, 24 Nov 2026: one was saved and never published). The same
 * rule as publish_tender: an online Tender Creation Form must be complete; otherwise an uploaded one will do.
 */
function PublishChecklist({ tenderId }: { tenderId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmation, askToConfirm] = useConfirmation();
  const [problem, setProblem] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const filesQuery = useDraftFiles(tenderId);
  const attachedQuery = useQuery({
    // Not the form page's key: that one caches the whole form for editing.
    queryKey: ['form-submission', 'attached-to-tender', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('form_submissions').select('form_version, data').eq('attached_to_type', 'tender').eq('attached_to_id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const definitionQuery = useFormDefinition(businessRequirementsFormKey, attachedQuery.data?.form_version);

  const attached = attachedQuery.data;
  const answersToComplete = attached && definitionQuery.data ? formProblems(definitionQuery.data.parsedSchema, attached.data as FormData, true).length : null;
  const hasUploadedForm = (filesQuery.data?.requirements.length ?? 0) > 0;
  const isFormDone = attached ? answersToComplete === 0 : hasUploadedForm;
  const formStatus = attached
    ? answersToComplete === 0
      ? 'Complete.'
      : `Started: ${answersToComplete ?? '…'} answers still to complete.`
    : hasUploadedForm
      ? 'Uploaded.'
      : 'Not filled in yet. Fill it in online, or upload a completed one under Documents below.';

  async function publish() {
    const { isConfirmed } = await askToConfirm(publishConfirmation);
    if (!isConfirmed) return;
    setProblem(null);
    setIsPublishing(true);
    const { error } = await supabase.rpc('publish_tender', { tender_id: tenderId });
    setIsPublishing(false);
    if (error) return setProblem(errorMessage(error));
    await Promise.all([['own-tenders'], ['open-tenders'], ['tender', tenderId]].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    void navigate(`/business/tenders/${tenderId}`);
  }

  const step = (isDone: boolean, text: ReactNode) => (
    <li className="flex gap-3">
      {isDone ? <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-green-700" aria-label="Done" /> : <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="To do" />}
      <div>{text}</div>
    </li>
  );

  return (
    <Card className="mb-6 max-w-3xl border-2 border-gold">
      {confirmation}
      <CardHeader>
        <h3 className="text-lg font-semibold text-navy-dark">Not published yet</h3>
        <CardDescription>Suppliers can't see this tender until you publish it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="grid gap-3">
          {step(true, <strong>Tender details saved</strong>)}
          {step(
            isFormDone,
            <>
              <strong>Tender Creation Form</strong>
              <p className="text-sm">
                {formStatus}{' '}
                <Link to={`/forms/${businessRequirementsFormKey}?tender=${tenderId}`}>{attached ? (isFormDone ? 'Edit the form' : 'Continue the form') : 'Fill in online'}</Link>
              </p>
            </>,
          )}
          {step(
            false,
            <>
              <strong>Publish</strong>
              <p className="text-sm text-muted-foreground">{isFormDone ? 'Ready: publish to open the tender for bids.' : 'Available once the Tender Creation Form is complete.'}</p>
              <Button type="button" variant="gold" className="mt-2" disabled={!isFormDone || isPublishing} onClick={() => void publish()}>
                {isPublishing ? 'Publishing…' : 'Publish'}
              </Button>
            </>,
          )}
        </ol>
        {problem && <Notice tone="error">{problem}</Notice>}
      </CardContent>
    </Card>
  );
}

/** Upload and remove files in a draft's folder; publish_tender records them when the tender is published. */
function DraftFiles({ tenderId }: { tenderId: string }) {
  const queryClient = useQueryClient();
  const filesQuery = useDraftFiles(tenderId);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function upload(input: HTMLInputElement, isRequirementsForm: boolean) {
    setProblem(null);
    // Copied before the box is cleared, so choosing the same file again after a failure or a removal works.
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    setIsBusy(true);
    try {
      for (const file of files) {
        const checked = checkDocument(file);
        if ('problem' in checked) throw new Error(checked.problem);
        const { error } = await supabase.storage
          .from('tender-documents')
          .upload(tenderDocumentPath(tenderId, file.name, isRequirementsForm), file, { contentType: checked.contentType });
        if (error) throw new Error(uploadProblem(file.name, error, draftUploadRule));
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setIsBusy(false);
      await queryClient.invalidateQueries({ queryKey: ['draft-files', tenderId] });
    }
  }

  async function remove(path: string) {
    setProblem(null);
    const { error } = await supabase.storage.from('tender-documents').remove([path]);
    if (error) setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['draft-files', tenderId] });
  }

  const fileRows = (files: { name: string; path: string }[]) =>
    files.length === 0 ? (
      <p className="text-sm text-muted-foreground">None yet.</p>
    ) : (
      <ul className="divide-y">
        {files.map((file) => (
          <li key={file.path} className="py-3">
            {file.name}{' '}
            <button
              type="button"
              className="cursor-pointer font-medium text-primary underline underline-offset-4 disabled:cursor-wait disabled:text-muted-foreground"
              onClick={() => void remove(file.path)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <Card className="mb-6">
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Documents</h3>
        <CardDescription>{acceptedDocumentDescription} each. Files can be changed until you publish.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {filesQuery.isPending && <Loading />}
        {filesQuery.isError && <ErrorNotice error={filesQuery.error} />}
        <div className="grid gap-3">
          <h4 className="font-semibold">Tender Creation Form, uploaded (instead of filling it in online)</h4>
          {filesQuery.data && fileRows(filesQuery.data.requirements)}
          <Field label="Upload a completed Tender Creation Form" htmlFor="requirementsUpload">
            <Input id="requirementsUpload" type="file" accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target, true)} />
          </Field>
        </div>
        <div className="grid gap-3">
          <h4 className="font-semibold">Supporting documents</h4>
          {filesQuery.data && fileRows(filesQuery.data.supporting)}
          <Field label="Add supporting documents" htmlFor="supportingUpload">
            <Input id="supportingUpload" type="file" multiple accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target, false)} />
          </Field>
        </div>
        {isBusy && <p className="text-sm text-muted-foreground">Uploading…</p>}
        {problem && <Notice tone="error">{problem}</Notice>}
      </CardContent>
    </Card>
  );
}

export function TenderFormPage() {
  const tenderId = useParams().tenderId ?? '';
  const isNew = tenderId === '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAccount();
  const categoriesQuery = useCategories();
  const [problem, setProblem] = useState<string | null>(null);

  const draftQuery = useQuery({
    queryKey: ['tender', tenderId, 'draft'],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const draft = draftQuery.data ?? null;
  const form = useForm<TenderValues>({
    resolver: zodResolver(tenderSchema),
    values: draft
      ? { title: draft.title, description: draft.description, categoryId: draft.category_id?.toString() ?? '', closesAtLocal: utcToJamaicaLocal(draft.closes_at) }
      : undefined,
  });
  const { errors, isSubmitting } = form.formState;

  async function save(values: TenderValues) {
    setProblem(null);
    const fields = {
      title: values.title,
      description: values.description,
      category_id: Number(values.categoryId),
      closes_at: jamaicaLocalToUtc(values.closesAtLocal),
    };
    if (isNew) {
      const { data, error } = await supabase.from('tenders').insert({ ...fields, business_id: session?.user.id ?? '' }).select('id').single();
      if (error) return setProblem(errorMessage(error));
      await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
      // Files go into the draft's own folder, so they can be added once it exists.
      void navigate(`/business/tenders/${data.id}/edit`, { replace: true });
      return;
    }
    // Only drafts can be changed; a tender published meanwhile (in another tab) matches no row.
    const { data: updated, error } = await supabase.from('tenders').update(fields).eq('id', tenderId).select('id');
    if (error) return setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['tender', tenderId] });
    await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
    if (updated.length === 0) return setProblem('Nothing was saved: this tender is no longer a draft. Open the tender to see where it stands.');
    void navigate(`/business/tenders/${tenderId}`);
  }

  // The category list must be there before the form, or a saved category shows as "Choose a category".
  if ((!isNew && draftQuery.isPending) || categoriesQuery.isPending) return <Loading />;
  if (draftQuery.isError) return <ErrorNotice error={draftQuery.error} />;
  if (categoriesQuery.isError) return <ErrorNotice error={categoriesQuery.error} />;
  if (!isNew && (!draft || draft.status !== 'draft')) {
    return <Notice tone="error">Only drafts can be edited. <Link to={`/business/tenders/${tenderId}`}>Go to the tender</Link>.</Notice>;
  }

  return (
    <>
      <PageHeader
        title={isNew ? 'Post a tender' : 'Edit draft'}
        description={
          isNew
            ? 'First describe what you need and when bids close. Next you fill in the Tender Creation Form and add any documents, then publish it. Nothing is public until you publish.'
            : 'Your draft is only visible to you. Finish the steps below, then publish it.'
        }
        back={isNew ? { to: '/business', label: 'My tenders' } : { to: `/business/tenders/${tenderId}`, label: 'Back to the tender' }}
      />
      {!isNew && <PublishChecklist tenderId={tenderId} />}
      <Card className="mb-6 max-w-3xl">
        <CardContent>
          <form className="grid gap-4" onSubmit={form.handleSubmit(save)} noValidate>
            <Field label="Title" htmlFor="tenderTitle" error={errors.title?.message}>
              <Input id="tenderTitle" maxLength={maximumTitleLength} {...form.register('title')} />
            </Field>
            <Field label="Category" htmlFor="tenderCategory" error={errors.categoryId?.message}>
              <NativeSelect id="tenderCategory" {...form.register('categoryId')}>
                <option value="">Choose a category</option>
                <CategoryOptions categories={categoriesQuery.data} />
              </NativeSelect>
            </Field>
            <Field label="Description" htmlFor="tenderDescription" error={errors.description?.message}>
              <Textarea id="tenderDescription" rows={8} {...form.register('description')} />
            </Field>
            <Field label="Closing date and time (Jamaica time)" htmlFor="tenderClosesAt" error={errors.closesAtLocal?.message}>
              <Input id="tenderClosesAt" type="datetime-local" {...form.register('closesAtLocal')} />
            </Field>
            {problem && <Notice tone="error">{problem}</Notice>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isNew ? 'Save draft and add documents' : 'Save draft'}</Button>
              <Button asChild variant="outline">
                <Link to={isNew ? '/business' : `/business/tenders/${tenderId}`}>Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {!isNew && <DraftFiles tenderId={tenderId} />}
    </>
  );
}
