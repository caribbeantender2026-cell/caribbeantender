/** One tender: its terms, deadline, document, and the right next step for whoever is looking. */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import { downloadStoredFile, useCompanyNames } from '../lib/queries.ts';
import { tenderPhase, tenderPhaseDisplay } from '../lib/rules.ts';
import { errorMessage, supabase } from '../lib/supabase.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

export function TenderDetailsPage() {
  const { tenderId = '' } = useParams();
  const { session, supplierProfile } = useAccount();
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);

  const tenderQuery = useQuery({
    queryKey: ['tender', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const tender = tenderQuery.data;
  const namesQuery = useCompanyNames('business_names_public', tender ? [tender.business_id] : []);

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (!tender) return <Notice tone="error">Tender not found. It may be a draft, or the link may be wrong.</Notice>;

  const phase = tenderPhase(tender);
  const isOwner = session?.user.id === tender.business_id;
  const documentPath = tender.document_path;

  async function downloadDocument() {
    if (!documentPath) return;
    setDownloadProblem(null);
    try {
      await downloadStoredFile('tender-documents', documentPath, tender?.document_name ?? 'tender-document');
    } catch (error) {
      setDownloadProblem(`Unable to download the document: ${errorMessage(error)}`);
    }
  }

  return (
    <div className="card">
      <h2>{tender.title}</h2>
      <p><strong>Business:</strong> {namesQuery.data?.get(tender.business_id) || 'Business'}</p>
      <p>
        <strong>Closes:</strong> {formatJamaicaDateTime(tender.closes_at)} (Jamaica time){' '}
        <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>
      </p>
      <p className="preserve-lines">{tender.description}</p>

      {documentPath && (
        <p>
          <strong>Supporting Document:</strong>{' '}
          {session ? (
            <button type="button" className="btn outline" onClick={() => void downloadDocument()}>
              Download {tender.document_name ?? 'document'}
            </button>
          ) : (
            <Link to={`/login?next=${encodeURIComponent(`/tenders/${tender.id}`)}`}>Log in to download the document</Link>
          )}
        </p>
      )}
      {downloadProblem && <Notice tone="error">{downloadProblem}</Notice>}

      {(phase === 'accepting-bids' || phase === 'awaiting-opening') && (
        <Notice>Bids are sealed. Bids open at {formatJamaicaDateTime(tender.closes_at)} (Jamaica time).</Notice>
      )}

      <div className="actions">
        {phase === 'accepting-bids' && supplierProfile && !isOwner && (
          <Link className="btn" to={`/tenders/${tender.id}/bid`}>Submit Bid</Link>
        )}
        {phase === 'accepting-bids' && !session && (
          <Link className="btn" to={`/login?next=${encodeURIComponent(`/tenders/${tender.id}/bid`)}`}>Log in as a supplier to bid</Link>
        )}
        {isOwner && <Link className="btn" to={`/business/tenders/${tender.id}/bids`}>Manage Bids</Link>}
        <Link className="btn gold" to="/tenders">Back to Tenders</Link>
      </div>
    </div>
  );
}
