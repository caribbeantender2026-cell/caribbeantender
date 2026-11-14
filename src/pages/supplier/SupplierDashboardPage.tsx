/** My bids: every bid the supplier has submitted, with its receipt, status and documents (PRD P1-10). */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { DocumentList } from '../../components/DocumentList.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import type { Enums } from '../../lib/database.types.ts';
import { formatAmount, useOwnSubscription } from '../../lib/queries.ts';
import { supplierHasAccess } from '../../lib/rules.ts';
import { supabase, supportEmail } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

const bidStatusLabels: Record<Enums<'bid_status'>, string> = {
  submitted: 'Submitted',
  awarded: 'Awarded',
  unsuccessful: 'Unsuccessful',
  tender_cancelled: 'Tender cancelled',
};

/** The supplier's own bids with their tenders' titles and their recorded documents. */
function useOwnBids(supplierId: string) {
  return useQuery({
    queryKey: ['own-bids', supplierId],
    queryFn: async () => {
      const bids = await supabase.from('bids').select('id, tender_id, amount, currency, status, submitted_at').eq('supplier_id', supplierId).order('submitted_at', { ascending: false });
      if (bids.error) throw bids.error;
      const bidIds = bids.data.map((bid) => bid.id);
      const [tenders, documents] = await Promise.all([
        supabase.from('tenders').select('id, title, closes_at').in('id', bids.data.map((bid) => bid.tender_id)),
        supabase.from('bid_documents').select('id, bid_id, file_name, document_role, size_bytes').in('bid_id', bidIds).order('file_name'),
      ]);
      if (tenders.error) throw tenders.error;
      if (documents.error) throw documents.error;
      const titles = new Map(tenders.data.map((tender) => [tender.id, tender.title]));
      return bids.data.map((bid) => ({
        ...bid,
        tenderTitle: titles.get(bid.tender_id) ?? 'Tender',
        documents: documents.data.filter((document) => document.bid_id === bid.id),
      }));
    },
  });
}

export function SupplierDashboardPage() {
  const { session } = useAccount();
  const supplierId = session?.user.id ?? '';
  const subscriptionQuery = useOwnSubscription(supplierId);
  const bidsQuery = useOwnBids(supplierId);
  const [statusFilter, setStatusFilter] = useState<Enums<'bid_status'> | ''>('');
  const subscription = subscriptionQuery.data ?? null;
  const shown = (bidsQuery.data ?? []).filter((bid) => statusFilter === '' || bid.status === statusFilter);

  return (
    <>
      <h2>My bids</h2>
      {subscriptionQuery.isSuccess &&
        (supplierHasAccess(subscription) ? (
          subscription?.status === 'trial' && subscription.trial_ends_at && (
            <Notice>Your free trial ends {formatJamaicaDateTime(subscription.trial_ends_at)} Jamaica time.</Notice>
          )
        ) : (
          <Notice>Your free trial has ended, so you can't submit new bids. Contact CaribbeanTender at {supportEmail} to continue.</Notice>
        ))}
      <div className="card">
        <label htmlFor="bidStatusFilter">Status</label>
        <select id="bidStatusFilter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Enums<'bid_status'> | '')}>
          <option value="">All</option>
          {Object.entries(bidStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </select>
        {bidsQuery.isPending && <Loading />}
        {bidsQuery.isError && <ErrorNotice error={bidsQuery.error} />}
        {bidsQuery.data && shown.length === 0 && (
          <p>No bids{statusFilter ? ' with this status' : ' yet'}. <Link to="/tenders">Browse open tenders</Link>.</p>
        )}
        {shown.map((bid) => (
          <div className="card" key={bid.id}>
            <h3><Link to={`/tenders/${bid.tender_id}`}>{bid.tenderTitle}</Link></h3>
            <p>
              {formatAmount(bid.amount, bid.currency)} · receipt: submitted {formatJamaicaDateTime(bid.submitted_at, { withSeconds: true })} Jamaica time ·{' '}
              <span className={`badge ${bid.status}`}>{bidStatusLabels[bid.status]}</span>
            </p>
            <DocumentList documents={bid.documents} />
          </div>
        ))}
      </div>
    </>
  );
}
