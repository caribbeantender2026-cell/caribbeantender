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
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
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
      <p className="small">None yet.</p>
    ) : (
      <ul className="links">
        {files.map((file) => (
          <li key={file.path}>
            {file.name}{' '}
            <button type="button" className="link-button" onClick={() => void remove(file.path)}>Remove</button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="card">
      <h3>Documents</h3>
      <p className="small">{acceptedDocumentDescription} each. Files can be changed until you publish.</p>
      {filesQuery.isPending && <Loading />}
      {filesQuery.isError && <ErrorNotice error={filesQuery.error} />}
      <h4>Requirements form (required to publish)</h4>
      {filesQuery.data && fileRows(filesQuery.data.requirements)}
      <label htmlFor="requirementsUpload">Upload the completed requirements form</label>
      <input id="requirementsUpload" type="file" accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target.files, true)} />
      <h4>Supporting documents</h4>
      {filesQuery.data && fileRows(filesQuery.data.supporting)}
      <label htmlFor="supportingUpload">Add supporting documents</label>
      <input id="supportingUpload" type="file" multiple accept={acceptedDocumentExtensions} disabled={isBusy} onChange={(event) => void upload(event.target.files, false)} />
      {isBusy && <p className="small">Uploading…</p>}
      {problem && <Notice tone="error">{problem}</Notice>}
    </div>
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
      <h2>{isNew ? 'Post a tender' : 'Edit draft'}</h2>
      <div className="card form">
        <form onSubmit={form.handleSubmit(save)} noValidate>
          <label htmlFor="tenderTitle">Title</label>
          <input id="tenderTitle" maxLength={maximumTitleLength} {...form.register('title')} />
          {errors.title && <div className="match-error">{errors.title.message}</div>}

          <label htmlFor="tenderCategory">Category</label>
          <select id="tenderCategory" {...form.register('categoryId')}>
            <option value="">Choose a category</option>
            {(categoriesQuery.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          {errors.categoryId && <div className="match-error">{errors.categoryId.message}</div>}

          <label htmlFor="tenderDescription">Description</label>
          <textarea id="tenderDescription" rows={8} {...form.register('description')} />
          {errors.description && <div className="match-error">{errors.description.message}</div>}

          <label htmlFor="tenderClosesAt">Closing date and time (Jamaica time)</label>
          <input id="tenderClosesAt" type="datetime-local" {...form.register('closesAtLocal')} />
          {errors.closesAtLocal && <div className="match-error">{errors.closesAtLocal.message}</div>}

          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="actions">
            <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : isNew ? 'Save draft and add documents' : 'Save draft'}</button>
            <Link className="btn outline" to={isNew ? '/business' : `/business/tenders/${tenderId}`}>Cancel</Link>
          </div>
        </form>
      </div>
      {!isNew && <DraftFiles tenderId={tenderId} />}
    </>
  );
}
