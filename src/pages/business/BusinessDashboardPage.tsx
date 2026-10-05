/** The business dashboard: every tender this business owns, with the lifecycle actions each allows. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import type { Tables } from '../../lib/database.types.ts';
import { tenderPhase, tenderPhaseDisplay, type TenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

type Tender = Tables<'tenders'>;

/** What the Bids column says: sealed tenders show when they open, opened ones show their count. */
function bidsSummary(tender: Tender, phase: TenderPhase, openedBidCounts: Map<string, number>): string {
  if (phase === 'draft') return 'Not published';
  if (phase === 'accepting-bids') return `Sealed until ${formatJamaicaDateTime(tender.closes_at)}`;
  if (phase === 'awaiting-opening') return 'Ready to open';
  if (phase === 'cancelled' && !tender.closed_at) return 'Never opened';
  return String(openedBidCounts.get(tender.id) ?? 0);
}

export function BusinessDashboardPage() {
  const { session } = useAccount();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const tendersQuery = useQuery({
    queryKey: ['my-tenders', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('business_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const tenderIds = (tendersQuery.data ?? []).map((tender) => tender.id);
  // The database only returns bids on tenders whose bids are open, so sealed tenders count as nothing here.
  const openedBidsQuery = useQuery({
    queryKey: ['opened-bid-counts', tenderIds],
    enabled: tenderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('bids').select('tender_id').in('tender_id', tenderIds);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const bid of data) counts.set(bid.tender_id, (counts.get(bid.tender_id) ?? 0) + 1);
      return counts;
    },
  });

  const lifecycleAction = useMutation({
    mutationFn: async (action: { tenderId: string; change: 'publish' | 'cancel' | 'delete' }) => {
      const { error } =
        action.change === 'delete'
          ? await supabase.from('tenders').delete().eq('id', action.tenderId)
          : await supabase.from('tenders').update({ status: action.change === 'publish' ? 'open' : 'cancelled' }).eq('id', action.tenderId);
      if (error) throw error;
    },
    onMutate: () => setProblem(null),
    onError: (error) => setProblem(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['my-tenders', userId] }),
  });

  function confirmThen(question: string, action: Parameters<typeof lifecycleAction.mutate>[0]) {
    if (window.confirm(question)) lifecycleAction.mutate(action);
  }

  const tenders = tendersQuery.data ?? [];
  const phases = new Map(tenders.map((tender) => [tender.id, tenderPhase(tender)]));
  const draftCount = tenders.filter((tender) => phases.get(tender.id) === 'draft').length;
  const acceptingCount = tenders.filter((tender) => phases.get(tender.id) === 'accepting-bids').length;

  return (
    <>
      <h2>Business Dashboard</h2>
      <section className="dashboard">
        <div className="stat"><strong>{tenders.length}</strong>My Tenders</div>
        <div className="stat"><strong>{draftCount}</strong>Drafts</div>
        <div className="stat"><strong>{acceptingCount}</strong>Accepting Bids</div>
      </section>

      <div className="card">
        <h3>Business Actions</h3>
        <div className="actions">
          <Link className="btn" to="/business/profile">Create / Update Company Profile</Link>
          <Link className="btn gold" to="/business/tenders/new">Create Tender</Link>
        </div>
      </div>

      <div className="card">
        <h3>My Tenders</h3>
        {problem && <Notice tone="error">{problem}</Notice>}
        {tendersQuery.isPending && <Loading />}
        {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
        {tendersQuery.data && (
          <table className="table">
            <thead>
              <tr><th>Tender</th><th>Status</th><th>Closes (Jamaica time)</th><th>Bids</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {tenders.length === 0 && <tr><td colSpan={5}>You have not created a tender yet.</td></tr>}
              {tenders.map((tender) => {
                const phase = phases.get(tender.id) ?? 'draft';
                return (
                  <tr key={tender.id}>
                    <td><Link to={`/tenders/${tender.id}`}>{tender.title}</Link></td>
                    <td><span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span></td>
                    <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                    <td>{bidsSummary(tender, phase, openedBidsQuery.data ?? new Map())}</td>
                    <td>
                      <div className="actions" style={{ marginTop: 0 }}>
                        {phase === 'draft' && (
                          <>
                            <Link className="btn outline" to={`/business/tenders/${tender.id}/edit`}>Edit</Link>
                            <button type="button" className="btn" disabled={lifecycleAction.isPending}
                              onClick={() => confirmThen(`Publish "${tender.title}"? Its terms cannot be changed after publishing.`, { tenderId: tender.id, change: 'publish' })}>
                              Publish
                            </button>
                            <button type="button" className="btn logout-btn" disabled={lifecycleAction.isPending}
                              onClick={() => confirmThen(`Delete the draft "${tender.title}"?`, { tenderId: tender.id, change: 'delete' })}>
                              Delete
                            </button>
                          </>
                        )}
                        {phase !== 'draft' && <Link className="btn" to={`/business/tenders/${tender.id}/bids`}>Bids</Link>}
                        {(phase === 'accepting-bids' || phase === 'awaiting-opening' || phase === 'opened') && (
                          <button type="button" className="btn logout-btn" disabled={lifecycleAction.isPending}
                            onClick={() => confirmThen(`Cancel "${tender.title}"? This cannot be undone.`, { tenderId: tender.id, change: 'cancel' })}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
