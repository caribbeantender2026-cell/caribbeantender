/** Create a tender, or edit a draft. A draft can be saved as often as needed; publishing fixes its terms. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { acceptedDocumentDescription, acceptedDocumentExtensions, checkDocument, documentStoragePath } from '../../lib/documents.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { jamaicaLocalToUtc, utcToJamaicaLocal } from '../../lib/time.ts';

const maximumTitleLength = 200;
const maximumDescriptionLength = 10_000;

const tenderSchema = z.object({
  title: z.string().trim().min(3, 'Use at least 3 characters for the title.').max(maximumTitleLength, `Use at most ${maximumTitleLength} characters.`),
  description: z.string().trim().min(1, 'Describe what you need.').max(maximumDescriptionLength, `Use at most ${maximumDescriptionLength} characters.`),
  closesAt: z.string().refine((value) => {
    try {
      jamaicaLocalToUtc(value);
      return true;
    } catch {
      return false;
    }
  }, 'Enter the closing date and time.'),
  document: z.custom<FileList>().optional(),
});
type TenderValues = z.infer<typeof tenderSchema>;

export function TenderFormPage() {
  const { tenderId } = useParams();
  const { session } = useAccount();
  const userId = session?.user.id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const existingQuery = useQuery({
    queryKey: ['tender', tenderId],
    enabled: tenderId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('id', tenderId ?? '').maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<TenderValues>({
    resolver: zodResolver(tenderSchema),
    values: existingQuery.data
      ? { title: existingQuery.data.title, description: existingQuery.data.description, closesAt: utcToJamaicaLocal(existingQuery.data.closes_at) }
      : undefined,
  });
  const { errors, isSubmitting } = form.formState;

  async function uploadChosenDocument(fileList: FileList | undefined): Promise<{ path: string; name: string } | null> {
    const file = fileList?.[0];
    if (!file) return null;
    const check = checkDocument(file);
    if ('problem' in check) throw new Error(check.problem);
    const path = documentStoragePath(userId, file.name);
    const { error } = await supabase.storage.from('tender-documents').upload(path, file, { contentType: check.contentType });
    if (error) throw new Error(`The document could not be uploaded: ${error.message}`);
    return { path, name: file.name };
  }

  async function save(values: TenderValues, publish: boolean) {
    setProblem(null);
    const closesAt = jamaicaLocalToUtc(values.closesAt);
    if (publish && new Date(closesAt).getTime() <= Date.now()) {
      setProblem('The closing time must be in the future to publish.');
      return;
    }
    try {
      const document = await uploadChosenDocument(values.document);
      const fields = {
        title: values.title,
        description: values.description,
        closes_at: closesAt,
        ...(document ? { document_path: document.path, document_name: document.name } : {}),
      };
      // Saving first and then publishing keeps one path for both new and existing drafts.
      const saved = tenderId
        ? await supabase.from('tenders').update(fields).eq('id', tenderId).select('id').single()
        : await supabase.from('tenders').insert({ ...fields, business_id: userId, status: 'draft' }).select('id').single();
      if (saved.error) throw saved.error;
      if (publish) {
        const published = await supabase.from('tenders').update({ status: 'open' }).eq('id', saved.data.id);
        if (published.error) throw published.error;
      }
      await queryClient.invalidateQueries({ queryKey: ['my-tenders', userId] });
      void navigate('/business');
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }

  if (tenderId && existingQuery.isPending) return <Loading />;
  if (existingQuery.isError) return <ErrorNotice error={existingQuery.error} />;
  if (tenderId && existingQuery.data?.status !== 'draft') {
    return <Notice tone="error">Only drafts can be edited. A published tender's terms are fixed so every supplier bids on the same terms.</Notice>;
  }

  return (
    <div className="card form">
      <h2>{tenderId ? 'Edit Draft Tender' : 'Create Tender'}</h2>
      <form noValidate onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="tenderTitle">Tender Title</label>
        <input id="tenderTitle" {...form.register('title')} />
        {errors.title && <div className="match-error">{errors.title.message}</div>}

        <label htmlFor="tenderDescription">Tender Description</label>
        <textarea id="tenderDescription" {...form.register('description')} />
        {errors.description && <div className="match-error">{errors.description.message}</div>}

        <label htmlFor="tenderClosesAt">Closing Date and Time (Jamaica time)</label>
        <input id="tenderClosesAt" type="datetime-local" {...form.register('closesAt')} />
        {errors.closesAt && <div className="match-error">{errors.closesAt.message}</div>}
        <p className="small">Bids are accepted until this moment and stay sealed until then.</p>

        <label htmlFor="tenderDocument">Supporting Document</label>
        <input id="tenderDocument" type="file" accept={acceptedDocumentExtensions} {...form.register('document')} />
        <p className="small">
          Optional. {acceptedDocumentDescription}.
          {existingQuery.data?.document_name && ` Current document: ${existingQuery.data.document_name}. Choosing a new file replaces it.`}
        </p>

        {problem && <Notice tone="error">{problem}</Notice>}
        <div className="actions">
          <button type="button" className="btn outline" disabled={isSubmitting} onClick={form.handleSubmit((values) => save(values, false))}>
            Save as Draft
          </button>
          <button type="button" className="btn" disabled={isSubmitting} onClick={form.handleSubmit((values) => save(values, true))}>
            {isSubmitting ? 'Please wait…' : 'Publish Tender'}
          </button>
          <Link className="btn gold" to="/business">Back to Dashboard</Link>
        </div>
      </form>
    </div>
  );
}
