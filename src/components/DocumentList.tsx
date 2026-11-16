/** A list of recorded tender or bid documents, each downloaded through a logged 60-second link. */
import { useState } from 'react';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import type { Enums } from '../lib/database.types.ts';
import { downloadDocument } from '../lib/queries.ts';
import { errorMessage } from '../lib/supabase.ts';
import { Notice } from './Notices.tsx';

const roleLabels: Record<Enums<'document_role'>, string> = {
  requirements_form: 'Requirements form',
  proposal: 'Proposal',
  supporting: 'Supporting document',
};
const bytesPerKilobyte = 1024;

export type RecordedDocument = { id: string; file_name: string; document_role: Enums<'document_role'>; size_bytes: number };

export function DocumentList({ documents }: { documents: RecordedDocument[] }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  if (documents.length === 0) {
    return <p className="small">No documents.</p>;
  }

  async function download(documentId: string) {
    setProblem(null);
    setDownloadingId(documentId);
    try {
      await downloadDocument(documentId);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <ul className="mt-2 divide-y rounded-lg border">
        {documents.map((document) => (
          <li key={document.id} className="flex items-center gap-3 px-3 py-2.5">
            <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <button type="button" className="link-button max-w-full truncate text-left" disabled={downloadingId !== null} onClick={() => void download(document.id)}>
                {document.file_name}
              </button>
              <p className="text-xs text-muted-foreground tabular-nums">
                {roleLabels[document.document_role]}, {Math.max(1, Math.round(document.size_bytes / bytesPerKilobyte))} KB
                {downloadingId === document.id && ', preparing…'}
              </p>
            </div>
            <DownloadIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </li>
        ))}
      </ul>
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}
