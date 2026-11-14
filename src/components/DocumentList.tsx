/** A list of recorded tender or bid documents, each downloaded through a logged 60-second link. */
import { useState } from 'react';
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
      <ul className="links">
        {documents.map((document) => (
          <li key={document.id}>
            <button type="button" className="link-button" disabled={downloadingId !== null} onClick={() => void download(document.id)}>
              {document.file_name}
            </button>{' '}
            <span className="small">
              {roleLabels[document.document_role]}, {Math.max(1, Math.round(document.size_bytes / bytesPerKilobyte))} KB
              {downloadingId === document.id && ' · preparing…'}
            </span>
          </li>
        ))}
      </ul>
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}
