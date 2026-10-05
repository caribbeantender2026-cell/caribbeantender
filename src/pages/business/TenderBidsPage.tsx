/** A business's view of one tender's bids: sealed until the deadline, then opened, downloaded and awarded. */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { downloadStoredFile, formatJamaicanDollars, useCompanyNames } from '../../lib/queries.ts';
import { tenderPhase, tenderPhaseDisplay } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

export function TenderBidsPage() {
  const { tenderId = '' } = useParams();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const tenderQuery = useQuery({
    queryKey: ['tender', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const tender = tenderQuery.data;
  const phase = tender ? tenderPhase(tender) : null;
  const bidsMayBeOpen = phase === 'opened' || phase === 'awarded' || (phase === 'cancelled' && tender?.closed_at !== null);

  const bidsQuery = useQuery({
    queryKey: ['tender-bids', tenderId],
    enabled: bidsMayBeOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bids')
        .select('id, supplier_id, amount, created_at, document_name')
        .eq('tender_id', tenderId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
  const namesQuery = useCompanyNames('supplier_names_public', (bidsQuery.data ?? []).map((bid) => bid.supplier_id));

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tender', tenderId] }),
      queryClient.invalidateQueries({ queryKey: ['tender-bids', tenderId] }),
    ]);

  // Closing is what opens the bids and writes the opening to the audit log.
  const openBids = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tenders').update({ status: 'closed' }).eq('id', tenderId);
      if (error) throw error;
    },
    onMutate: () => setProblem(null),
    onError: (error) => setProblem(errorMessage(error)),
    onSettled: refresh,
  });

  const awardBid = useMutation({
    mutationFn: async (bidId: string) => {
      const { error } = await supabase.from('tenders').update({ status: 'awarded', awarded_bid_id: bidId }).eq('id', tenderId);
      if (error) throw error;
    },
    onMutate: () => setProblem(null),
    onError: (error) => setProblem(errorMessage(error)),
    onSettled: refresh,
  });

  async function downloadProposal(bidId: string, documentName: string) {
    setProblem(null);
    try {
      // Recording the download first is what lets storage hand over the file.
      const { data: documentPath, error } = await supabase.rpc('request_bid_document_download', { requested_bid_id: bidId });
      if (error) throw error;
      await downloadStoredFile('bid-documents', documentPath, documentName);
    } catch (error) {
      setProblem(`Unable to download the proposal: ${errorMessage(error)}`);
    }
  }

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (!tender || !phase) return <Notice tone="error">Tender not found.</Notice>;

  return (
    <>
      <h2>Bids: {tender.title}</h2>
      <div className="card">
        <p>
          <strong>Closes:</strong> {formatJamaicaDateTime(tender.closes_at)} (Jamaica time){' '}
          <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>
        </p>
        {problem && <Notice tone="error">{problem}</Notice>}

        {phase === 'draft' && <Notice>This tender is a draft. Publish it to start receiving bids.</Notice>}
        {phase === 'accepting-bids' && (
          <Notice>Bids are sealed. Bids open at {formatJamaicaDateTime(tender.closes_at)} (Jamaica time). Nobody, including you, can see them before then.</Notice>
        )}
        {phase === 'awaiting-opening' && (
          <Notice>
            The deadline passed at {formatJamaicaDateTime(tender.closes_at)}. The bids open when the tender is closed, which happens
            automatically within a minute, or now if you open them.
            <div className="actions">
              <button type="button" className="btn" disabled={openBids.isPending} onClick={() => openBids.mutate()}>
                {openBids.isPending ? 'Opening…' : 'Open the Bids'}
              </button>
            </div>
          </Notice>
        )}
        {phase === 'cancelled' && !tender.closed_at && <Notice>This tender was cancelled before its deadline, so its bids were never opened.</Notice>}

        {bidsMayBeOpen && bidsQuery.isPending && <Loading />}
        {bidsQuery.isError && <ErrorNotice error={bidsQuery.error} />}
        {bidsQuery.data && (
          <table className="table">
            <thead>
              <tr><th>Supplier</th><th>Bid Amount</th><th>Submitted (Jamaica time)</th><th>Proposal Document</th><th>Award</th></tr>
            </thead>
            <tbody>
              {bidsQuery.data.length === 0 && <tr><td colSpan={5}>No bids were submitted.</td></tr>}
              {bidsQuery.data.map((bid) => (
                <tr key={bid.id}>
                  <td>{namesQuery.data?.get(bid.supplier_id) || 'Supplier'}</td>
                  <td>{formatJamaicanDollars(bid.amount)}</td>
                  <td>{formatJamaicaDateTime(bid.created_at, { withSeconds: true })}</td>
                  <td>
                    <button type="button" className="btn outline" onClick={() => void downloadProposal(bid.id, bid.document_name)}>
                      {bid.document_name}
                    </button>
                  </td>
                  <td>
                    {tender.awarded_bid_id === bid.id && <span className="badge awarded">Awarded</span>}
                    {phase === 'opened' && (
                      <button
                        type="button"
                        className="btn gold"
                        disabled={awardBid.isPending}
                        onClick={() => {
                          if (window.confirm('Award the tender to this bid? This cannot be undone.')) awardBid.mutate(bid.id);
                        }}
                      >
                        Award
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions">
          <Link className="btn gold" to="/business">Back to Dashboard</Link>
        </div>
      </div>
    </>
  );
}
