/** My bids: every bid the supplier has submitted, with its receipt, status and documents (PRD P1-10). */
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Label, NativeSelect } from '../../components/ui/fields.tsx';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { DocumentList } from '../../components/DocumentList.tsx';
import { AttachedForm } from '../../components/FormFields.tsx';
import type { FormData } from '../../lib/forms.ts';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import type { Enums } from '../../lib/database.types.ts';
import { formatAmount, useOwnSubscription } from '../../lib/queries.ts';
import { bidStatusLabels, subscriptionPrices, supplierHasAccess } from '../../lib/rules.ts';
import { supabase, supportEmail } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

/** The supplier's own bids with their tenders' titles and their recorded documents. */
function useOwnBids(supplierId: string) {
  return useQuery({
    queryKey: ['own-bids', supplierId],
    queryFn: async () => {
      const bids = await supabase.from('bids').select('id, tender_id, amount, currency, status, submitted_at').eq('supplier_id', supplierId).order('submitted_at', { ascending: false });
      if (bids.error) throw bids.error;
      const bidIds = bids.data.map((bid) => bid.id);
      const [tenders, documents, forms] = await Promise.all([
        supabase.from('tenders').select('id, title, closes_at').in('id', bids.data.map((bid) => bid.tender_id)),
        supabase.from('bid_documents').select('id, bid_id, file_name, document_role, size_bytes').in('bid_id', bidIds).order('file_name'),
        supabase.from('form_submissions').select('attached_to_id, form_key, form_version, data').eq('attached_to_type', 'bid').in('attached_to_id', bidIds),
      ]);
      if (tenders.error) throw tenders.error;
      if (documents.error) throw documents.error;
      if (forms.error) throw forms.error;
      const titles = new Map(tenders.data.map((tender) => [tender.id, tender.title]));
      return bids.data.map((bid) => ({
        ...bid,
        tenderTitle: titles.get(bid.tender_id) ?? 'Tender',
        documents: documents.data.filter((document) => document.bid_id === bid.id),
        proposalForm: forms.data.find((form) => form.attached_to_id === bid.id) ?? null,
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-navy-dark sm:text-3xl">My bids</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every bid you have submitted, with its receipt.</p>
        </div>
        <div className="grid w-full gap-2 sm:w-56">
          <Label htmlFor="bidStatusFilter">Status</Label>
          <NativeSelect id="bidStatusFilter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Enums<'bid_status'> | '')}>
            <option value="">All</option>
            {Object.entries(bidStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </NativeSelect>
        </div>
      </div>
      {subscriptionQuery.isSuccess &&
        (supplierHasAccess(subscription) ? (
          subscription?.status === 'trial' && subscription.trial_ends_at && (
            <Notice>Your free trial ends {formatJamaicaDateTime(subscription.trial_ends_at)} Jamaica time. After that, a subscription is {subscriptionPrices}.</Notice>
          )
        ) : (
          <Notice>Your free trial has ended, so you can't submit new bids. A subscription is {subscriptionPrices}. Contact CaribbeanTender at {supportEmail} to subscribe.</Notice>
        ))}
      {bidsQuery.isPending && <Loading />}
      {bidsQuery.isError && <ErrorNotice error={bidsQuery.error} />}
      {bidsQuery.data && shown.length === 0 && (
        <Card className="items-center py-14 text-center">
          <p className="text-sm text-muted-foreground">No bids{statusFilter ? ' with this status' : ' yet'}.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/tenders">Browse open tenders</Link>
          </Button>
        </Card>
      )}
      <div className="grid gap-4">
        {shown.map((bid) => (
          <Card key={bid.id}>
            <CardHeader>
              <CardTitle className="text-base leading-snug">
                <Link to={`/tenders/${bid.tender_id}`} className="text-navy-dark">{bid.tenderTitle}</Link>
              </CardTitle>
              <CardAction>
                <span className={`badge ${bid.status}`}>{bidStatusLabels[bid.status]}</span>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-navy-dark tabular-nums">{formatAmount(bid.amount, bid.currency)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Receipt</dt>
                  <dd className="mt-0.5 tabular-nums">Submitted {formatJamaicaDateTime(bid.submitted_at, { withSeconds: true })} Jamaica time</dd>
                </div>
              </dl>
              <DocumentList documents={bid.documents} />
              {bid.proposalForm && (
                <AttachedForm formKey={bid.proposalForm.form_key} formVersion={bid.proposalForm.form_version} data={bid.proposalForm.data as FormData} notes={[`Proposal for "${bid.tenderTitle}"`]} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
