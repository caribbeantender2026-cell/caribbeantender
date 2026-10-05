/** Submit a sealed bid with its proposal document, and show the receipt with the exact submission time. */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { acceptedDocumentDescription, acceptedDocumentExtensions, checkDocument, documentStoragePath } from '../../lib/documents.ts';
import { formatJamaicanDollars, useOwnSubscription } from '../../lib/queries.ts';
import { supplierHasAccess, tenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

// Matches bids.amount numeric(14,2): up to 12 digits before the point and 2 after.
const amountPattern = /^\d{1,12}(\.\d{1,2})?$/;

const bidSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(amountPattern, 'Enter an amount in Jamaican dollars using numbers only, for example 1200000.00.')
    .refine((value) => Number(value) > 0, 'The amount must be more than zero.'),
  document: z.custom<FileList>((value) => value instanceof FileList && value.length === 1, 'Choose your proposal document.'),
});
type BidValues = z.infer<typeof bidSchema>;

/** The bid receipt: what was submitted and exactly when, according to the database. */
function Receipt({ amount, submittedAt, documentName }: { amount: number; submittedAt: string; documentName: string }) {
  return (
    <Notice tone="success">
      <strong>Bid received.</strong> {formatJamaicanDollars(amount)} with {documentName}, submitted at{' '}
      <strong>{formatJamaicaDateTime(submittedAt, { withSeconds: true })}</strong> (Jamaica time). It stays sealed until the tender closes and cannot be changed.
    </Notice>
  );
}

export function SubmitBidPage() {
  const { tenderId = '' } = useParams();
  const { session } = useAccount();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<BidValues>({ resolver: zodResolver(bidSchema) });
  const { errors, isSubmitting } = form.formState;
  const subscriptionQuery = useOwnSubscription(userId);

  const tenderQuery = useQuery({
    queryKey: ['tender', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const existingBidQuery = useQuery({
    queryKey: ['my-bid', tenderId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bids')
        .select('amount, created_at, document_name')
        .eq('tender_id', tenderId)
        .eq('supplier_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function submitBid(values: BidValues) {
    setProblem(null);
    const file = values.document[0];
    if (!file) return;
    const check = checkDocument(file);
    if ('problem' in check) {
      setProblem(check.problem);
      return;
    }
    const documentPath = documentStoragePath(userId, file.name);
    const upload = await supabase.storage.from('bid-documents').upload(documentPath, file, { contentType: check.contentType });
    if (upload.error) {
      setProblem(`The proposal could not be uploaded: ${upload.error.message}`);
      return;
    }
    const { error } = await supabase
      .from('bids')
      .insert({ tender_id: tenderId, supplier_id: userId, amount: Number(values.amount), document_path: documentPath, document_name: file.name });
    if (error) {
      // Uploaded files can never be deleted (so a submitted proposal can never be swapped); this one stays unattached.
      setProblem(`The bid was not accepted: ${errorMessage(error)} Your uploaded file was not attached to any bid.`);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-bid', tenderId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['my-bids', userId] }),
    ]);
  }

  if (tenderQuery.isPending || existingBidQuery.isPending || subscriptionQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (existingBidQuery.isError) return <ErrorNotice error={existingBidQuery.error} />;
  const tender = tenderQuery.data;
  if (!tender) return <Notice tone="error">Tender not found.</Notice>;

  const existingBid = existingBidQuery.data;
  const isAcceptingBids = tenderPhase(tender) === 'accepting-bids';
  const hasAccess = supplierHasAccess(subscriptionQuery.data ?? null);

  return (
    <div className="card form">
      <h2>Submit Bid</h2>
      <p>
        <strong>{tender.title}</strong>. Closes {formatJamaicaDateTime(tender.closes_at)} (Jamaica time).
      </p>
      {existingBid && <Receipt amount={existingBid.amount} submittedAt={existingBid.created_at} documentName={existingBid.document_name} />}
      {!existingBid && !isAcceptingBids && <Notice tone="error">This tender is no longer accepting bids.</Notice>}
      {!existingBid && isAcceptingBids && !hasAccess && (
        <Notice tone="error">
          Your free trial has ended. An active subscription is required to submit bids. <Link to="/subscription?reason=trial-expired">View plans</Link>.
        </Notice>
      )}
      {!existingBid && isAcceptingBids && hasAccess && (
        <form onSubmit={form.handleSubmit(submitBid)} noValidate>
          <label htmlFor="bidAmount">Bid Amount (JMD)</label>
          <div className="amount-field">
            <span className="currency-prefix">J$</span>
            <input id="bidAmount" inputMode="decimal" placeholder="1200000.00" {...form.register('amount')} />
          </div>
          {errors.amount && <div className="match-error">{errors.amount.message}</div>}
          <p className="small">Enter numbers only. Example: 1200000.00</p>

          <label htmlFor="proposalDocument">Proposal Document</label>
          <input id="proposalDocument" type="file" accept={acceptedDocumentExtensions} {...form.register('document')} />
          {errors.document && <div className="match-error">{errors.document.message}</div>}
          <p className="small">Accepted: {acceptedDocumentDescription}. A submitted bid and its document cannot be changed.</p>

          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="actions">
            <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting…' : 'Submit Bid'}</button>
            <Link className="btn gold" to={`/tenders/${tender.id}`}>Back to Tender</Link>
          </div>
        </form>
      )}
    </div>
  );
}
