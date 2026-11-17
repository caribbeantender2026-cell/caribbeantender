/**
 * Create or edit a draft tender and its files (PRD P1-06). Drafts are fully editable; once published,
 * a tender is managed from its page, where only the closing time can be extended.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { CategoryOptions } from '../../components/CategoryOptions.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, NativeSelect, Textarea } from '../../components/ui/fields.tsx';
import { acceptedDocumentDescription, acceptedDocumentExtensions, checkDocument, tenderDocumentPath } from '../../lib/documents.ts';
import { useCategories } from '../../lib/queries.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { jamaicaLocalToUtc, utcToJamaicaLocal } from '../../lib/time.ts';

const maximumTitleLength = 200;
const maximumDescriptionLength = 20_000;
const requirementsFolder = 'requirements-form';

const tenderSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(maximumTitleLength, `Use at most ${maximumTitleLength} characters.`),
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

/** Whether the draft has its requirements form filled in online, with a link to fill it in or edit it. */
function OnlineRequirementsForm({ tenderId }: { tenderId: string }) {
  const attachedQuery = useQuery({
    queryKey: ['form-submission', 'business-requirements', tenderId, null],
    queryFn: async () => {
      const { data, error } = await supabase.from('form_submissions').select('id').eq('attached_to_type', 'tender').eq('attached_to_id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const isFilledIn = attachedQuery.data !== null && attachedQuery.data !== undefined;
  return (
    <p>
      {isFilledIn ? 'Filled in online. ' : 'Fill it in online, or upload the completed form below. '}
      <Link to={`/forms/business-requirements?tender=${tenderId}`}>{isFilledIn ? 'Edit the online form' : 'Fill in online'}</Link>
    </p>
  );
}

/** Upload and remove files in a draft's folder; publish_tender records them when the tender is published. */
function DraftFiles({ tenderId }: { tenderId: string }) {
  const queryClient = useQueryClient();
  const filesQuery = useDraftFiles(tenderId);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function upload(files: FileList | null, isRequirementsForm: boolean) {
    setProblem(null);
    if (!files) return;
    setIsBusy(true);
    try {
      for (const file of Array.from(files)) {
        const checked = checkDocument(file);
        if ('problem' in checked) throw new Error(checked.problem);
        const { error } = await supabase.storage
          .from('tender-documents')
          .upload(tenderDocumentPath(tenderId, file.name, isRequirementsForm), file, { contentType: checked.contentType });
        if (error) throw new Error(`"${file.name}" was not uploaded: ${error.message}`);
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
          <h4 className="font-semibold">Requirements form (required to publish)</h4>
          <OnlineRequirementsForm tenderId={tenderId} />
          {filesQuery.data && fileRows(filesQuery.data.requirements)}
          <Field label="Upload the completed requirements form" htmlFor="requirementsUpload">
            <Input id="requirementsUpload" type="file" accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target.files, true)} />
          </Field>
        </div>
        <div className="grid gap-3">
          <h4 className="font-semibold">Supporting documents</h4>
          {filesQuery.data && fileRows(filesQuery.data.supporting)}
          <Field label="Add supporting documents" htmlFor="supportingUpload">
            <Input id="supportingUpload" type="file" multiple accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target.files, false)} />
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
      // Files go into the draft's own folder, so they can be added once it exists.
      void navigate(`/business/tenders/${data.id}/edit`, { replace: true });
      return;
    }
    const { error } = await supabase.from('tenders').update(fields).eq('id', tenderId);
    if (error) return setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['tender', tenderId] });
    void navigate(`/business/tenders/${tenderId}`);
  }

  if (!isNew && draftQuery.isPending) return <Loading />;
  if (draftQuery.isError) return <ErrorNotice error={draftQuery.error} />;
  if (!isNew && (!draft || draft.status !== 'draft')) {
    return <Notice tone="error">Only drafts can be edited. <Link to={`/business/tenders/${tenderId}`}>Go to the tender</Link>.</Notice>;
  }

  return (
    <>
      <PageHeader
        title={isNew ? 'Post a tender' : 'Edit draft'}
        description={
          isNew
            ? 'First describe what you need and when bids close. Next you add the requirements form and any documents, then publish it. Nothing is public until you publish.'
            : 'Your draft is only visible to you. Change the details, add the requirements form and documents below, then publish it from the tender page.'
        }
        back={isNew ? { to: '/business', label: 'My tenders' } : { to: `/business/tenders/${tenderId}`, label: 'Back to the tender' }}
      />
      <Card className="mb-6 max-w-3xl">
        <CardContent>
          <form className="grid gap-4" onSubmit={form.handleSubmit(save)} noValidate>
            <Field label="Title" htmlFor="tenderTitle" error={errors.title?.message}>
              <Input id="tenderTitle" maxLength={maximumTitleLength} {...form.register('title')} />
            </Field>
            <Field label="Category" htmlFor="tenderCategory" error={errors.categoryId?.message}>
              <NativeSelect id="tenderCategory" {...form.register('categoryId')}>
                <option value="">Choose a category</option>
                <CategoryOptions categories={categoriesQuery.data ?? []} />
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
