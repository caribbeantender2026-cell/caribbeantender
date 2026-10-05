/** The supplier dashboard: trial or subscription status, and every bid this supplier has submitted. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import type { Tables } from '../../lib/database.types.ts';
import { downloadStoredFile, formatJamaicanDollars, useOpenTenders, useOwnSubscription } from '../../lib/queries.ts';
import { supplierHasAccess, tenderPhase, tenderPhaseDisplay } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

const millisecondsPerDay = 86_400_000;

/** The status card, in the original page's three styles: trial, active subscription, or expired. */
function SubscriptionStatus({ subscription }: { subscription: Tables<'subscriptions'> | null }) {
  if (subscription && supplierHasAccess(subscription) && subscription.status === 'active' && subscription.current_period_ends_at) {
    return (
      <div className="subscription-active">
        <strong>✓ SUBSCRIPTION ACTIVE</strong>
        <p>Plan: <strong>{subscription.plan_code ?? 'Supplier Plan'}</strong></p>
        <p>Current period ends: <strong>{formatJamaicaDateTime(subscription.current_period_ends_at)}</strong></p>
      </div>
    );
  }
  if (subscription && supplierHasAccess(subscription) && subscription.trial_ends_at) {
    const daysRemaining = Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / millisecondsPerDay);
    return (
      <div className="trial-active">
        <strong>FREE SUPPLIER TRIAL</strong>
        <h2>{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining</h2>
        <p>Your free Supplier trial ends <strong>{formatJamaicaDateTime(subscription.trial_ends_at)}</strong>.</p>
        <Link className="btn" to="/subscription">View Plans</Link>
      </div>
    );
  }
  return (
    <div className="trial-expired">
      <strong>SUPPLIER SUBSCRIPTION REQUIRED</strong>
      <p>Your free Supplier trial has ended. Subscribe to continue submitting bids.</p>
      <Link className="btn" to="/subscription">Subscribe Now</Link>
    </div>
  );
}

export function SupplierDashboardPage() {
  const { session } = useAccount();
  const userId = session?.user.id ?? '';
  const [problem, setProblem] = useState<string | null>(null);
  const subscriptionQuery = useOwnSubscription(userId);
  const openTendersQuery = useOpenTenders();

  const bidsQuery = useQuery({
    queryKey: ['my-bids', userId],
    queryFn: async () => {
      const { data: bids, error } = await supabase
        .from('bids')
        .select('id, tender_id, amount, created_at, document_name')
        .eq('supplier_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const tenderIds = [...new Set(bids.map((bid) => bid.tender_id))];
      const { data: tenders, error: tendersError } = tenderIds.length
        ? await supabase.from('tenders').select('id, title, status, closes_at').in('id', tenderIds)
        : { data: [], error: null };
      if (tendersError) throw tendersError;
      const tendersById = new Map(tenders.map((tender) => [tender.id, tender]));
      return bids.map((bid) => ({ ...bid, tender: tendersById.get(bid.tender_id) ?? null }));
    },
  });

  async function downloadOwnProposal(bidId: string, documentName: string) {
    setProblem(null);
    try {
      const { data: documentPath, error } = await supabase.rpc('request_bid_document_download', { requested_bid_id: bidId });
      if (error) throw error;
      await downloadStoredFile('bid-documents', documentPath, documentName);
    } catch (error) {
      setProblem(`Unable to download your proposal: ${errorMessage(error)}`);
    }
  }

  return (
    <>
      <h2>Supplier Dashboard</h2>
      <div className="card subscription-card">
        <h3>Supplier Account Status</h3>
        {subscriptionQuery.isPending && <Loading />}
        {subscriptionQuery.isError && <ErrorNotice error={subscriptionQuery.error} />}
        {subscriptionQuery.isSuccess && <SubscriptionStatus subscription={subscriptionQuery.data} />}
      </div>

      <section className="dashboard">
        <div className="stat"><strong>{openTendersQuery.data?.length ?? '–'}</strong>Open Tenders</div>
        <div className="stat"><strong>{bidsQuery.data?.length ?? '–'}</strong>Submitted Bids</div>
        <div className="stat"><strong>{subscriptionQuery.data && supplierHasAccess(subscriptionQuery.data) ? 'Yes' : 'No'}</strong>Can Bid</div>
      </section>

      <div className="card">
        <h3>Supplier Actions</h3>
        <div className="actions">
          <Link className="btn" to="/supplier/profile">Create / Update Supplier Profile</Link>
          <Link className="btn gold" to="/tenders">Browse Tenders</Link>
        </div>
      </div>

      <div className="card">
        <h3>My Bids</h3>
        {problem && <Notice tone="error">{problem}</Notice>}
        {bidsQuery.isPending && <Loading />}
        {bidsQuery.isError && <ErrorNotice error={bidsQuery.error} />}
        {bidsQuery.data && (
          <table className="table">
            <thead>
              <tr><th>Tender</th><th>Amount</th><th>Submitted (Jamaica time)</th><th>Tender Status</th><th>Proposal</th></tr>
            </thead>
            <tbody>
              {bidsQuery.data.length === 0 && <tr><td colSpan={5}>You have not submitted a bid yet.</td></tr>}
              {bidsQuery.data.map((bid) => {
                const phase = bid.tender ? tenderPhase(bid.tender) : null;
                return (
                  <tr key={bid.id}>
                    <td>{bid.tender ? <Link to={`/tenders/${bid.tender_id}`}>{bid.tender.title}</Link> : 'Tender no longer listed'}</td>
                    <td>{formatJamaicanDollars(bid.amount)}</td>
                    <td>{formatJamaicaDateTime(bid.created_at, { withSeconds: true })}</td>
                    <td>{phase && <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>}</td>
                    <td>
                      <button type="button" className="btn outline" onClick={() => void downloadOwnProposal(bid.id, bid.document_name)}>
                        {bid.document_name}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Notice>Suppliers may submit one bid per tender. A bid and its proposal document cannot be changed after submission.</Notice>
    </>
  );
}
