/**
 * Submit a sealed bid (PRD P1-08): an amount in Jamaican dollars, the proposal and optional supporting
 * documents. Files go into the bid's own folder first; submit_bid then checks every rule, records the
 * files and sets the submission time. A bid can't be changed afterwards.
 */
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { FormFields, useFormDefinition } from '../../components/FormFields.tsx';
import { useConfirmation } from '../../components/ConfirmDialog.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { BidReceipt } from '../../components/TenderView.tsx';
import type { Json } from '../../lib/database.types.ts';
import { formProblems, type FormData } from '../../lib/forms.ts';
import { acceptedDocumentDescription, acceptedDocumentExtensions, bidDocumentPath, checkDocument } from '../../lib/documents.ts';
import { formatAmount, useOwnSubscription } from '../../lib/queries.ts';
import { subscriptionPrices, supplierHasAccess, tenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase, supportEmail } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';
import { useTender } from '../TenderDetailsPage.tsx';

// Matches submit_bid: above zero, below 10^12 (numeric(14,2)), at most two decimal places.
const maximumAmount = 1_000_000_000_000;
const amountPattern = /^\d+(\.\d{1,2})?$/;

export function SubmitBidPage() {
  const tenderId = useParams().tenderId ?? '';
  const { session } = useAccount();
  const supplierId = session?.user.id ?? '';
  const queryClient = useQueryClient();
  const tenderQuery = useTender(tenderId);
  const subscriptionQuery = useOwnSubscription(supplierId);
  const existingBidQuery = useQuery({
    queryKey: ['own-bid', tenderId, supplierId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bids').select('amount, currency, submitted_at').eq('tender_id', tenderId).eq('supplier_id', supplierId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // One id for this bid, chosen here so its files can be uploaded into its folder before it exists.
  const [bidId] = useState(() => crypto.randomUUID());
  const uploadedPaths = useRef(new Set<string>());
  const proposalDefinitionQuery = useFormDefinition('supplier-proposal');
  // The proposal is a file, or the supplier proposal form filled in online (PRD P1-08).
  const [proposalMode, setProposalMode] = useState<'file' | 'online'>('file');
  const [proposalData, setProposalData] = useState<FormData>({});
  // Saved once, then updated on a retry, so a failed submission never leaves duplicate forms behind.
  const proposalSubmissionId = useRef<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [proposal, setProposal] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmation, askToConfirm] = useConfirmation();

  if (tenderQuery.isPending || subscriptionQuery.isPending || existingBidQuery.isPending) return <Loading />;
  for (const query of [tenderQuery, subscriptionQuery, existingBidQuery]) {
    if (query.isError) return <ErrorNotice error={query.error} />;
  }
  const tender = tenderQuery.data?.tender ?? null;
  if (!tender) return <Notice tone="error">Tender not found.</Notice>;
  const existingBid = existingBidQuery.data;

  /** Uploads one file into this bid's folder, once, even if the person submits again after an error. */
  async function uploadOnce(file: File, isProposal: boolean) {
    const checked = checkDocument(file);
    if ('problem' in checked) throw new Error(checked.problem);
    const path = bidDocumentPath(tenderId, bidId, file.name, isProposal);
    if (uploadedPaths.current.has(path)) return;
    const { error } = await supabase.storage.from('bid-documents').upload(path, file, { contentType: checked.contentType });
    if (error) throw new Error(`"${file.name}" was not uploaded: ${error.message}`);
    uploadedPaths.current.add(path);
  }

  /** Saves the online proposal form, unattached; submit_bid attaches it and locks it. */
  async function saveProposalForm(): Promise<string> {
    if (proposalSubmissionId.current) {
      const updated = await supabase.from('form_submissions').update({ data: proposalData as Json }).eq('id', proposalSubmissionId.current);
      if (updated.error) throw updated.error;
      return proposalSubmissionId.current;
    }
    const inserted = await supabase
      .from('form_submissions')
      .insert({ form_key: 'supplier-proposal', form_version: proposalDefinitionQuery.data?.version ?? 1, owner_id: supplierId, data: proposalData as Json })
      .select('id')
      .single();
    if (inserted.error) throw inserted.error;
    proposalSubmissionId.current = inserted.data.id;
    return inserted.data.id;
  }

  async function submit() {
    setProblem(null);
    const amount = Number(amountText);
    if (!amountPattern.test(amountText.trim()) || !(amount > 0) || amount >= maximumAmount) {
      return setProblem('Enter a bid amount above zero, with at most two decimal places.');
    }
    const proposalSchema = proposalDefinitionQuery.data?.parsedSchema;
    if (proposalMode === 'file' && !proposal) return setProblem('Attach your proposal.');
    if (proposalMode === 'online') {
      const problems = formProblems(proposalSchema ?? { fields: [] }, proposalData, true);
      if (!proposalSchema || problems.length > 0) return setProblem(problems.join(' ') || 'The proposal form is not available.');
    }
    const { isConfirmed } = await askToConfirm({
      title: `Submit a bid of ${formatAmount(amount)}?`,
      message: "Your bid stays sealed until the closing time, and it can't be changed after you submit it.",
      confirmLabel: 'Submit my bid',
      cancelLabel: 'Not yet',
      tone: 'go-ahead',
    });
    if (!isConfirmed) return;
    setIsSubmitting(true);
    try {
      let proposalFormId: string | undefined;
      if (proposalMode === 'file' && proposal) {
        await uploadOnce(proposal, true);
      } else {
        proposalFormId = await saveProposalForm();
      }
      for (const file of supportingFiles) await uploadOnce(file, false);
      const { error } = await supabase.rpc('submit_bid', {
        tender_id: tenderId,
        bid_id: bidId,
        amount,
        ...(proposalFormId ? { proposal_form_submission_id: proposalFormId } : {}),
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['own-bid', tenderId, supplierId] });
      await queryClient.invalidateQueries({ queryKey: ['own-bids'] });
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const header = (
    <PageHeader
      title={`Bid: ${tender.title}`}
      description={`Closes ${formatJamaicaDateTime(tender.closes_at)} Jamaica time. Your bid is sealed: nobody, not even the business, sees it before then, and it can't be changed once submitted.`}
      back={{ to: `/tenders/${tender.id}`, label: 'Back to the tender' }}
    />
  );
  if (existingBid) {
    return <>{header}<BidReceipt amount={existingBid.amount} currency={existingBid.currency} submittedAt={existingBid.submitted_at} /></>;
  }
  if (!supplierHasAccess(subscriptionQuery.data ?? null)) {
    return (
      <>
        {header}
        <Notice>Your free trial has ended, so you can't submit bids. A subscription is {subscriptionPrices}. Contact CaribbeanTender at {supportEmail} to subscribe.</Notice>
      </>
    );
  }
  if (tenderPhase(tender) !== 'accepting-bids') {
    return <>{header}<Notice tone="error">This tender is no longer taking bids.</Notice></>;
  }

  return (
    <>
      {header}
      {confirmation}
      <div className="card form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
        >
          <label htmlFor="bidAmount">Amount (Jamaican dollars, JMD)</label>
          <div className="amount-field">
            <span className="currency-prefix">J$</span>
            <input id="bidAmount" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} required />
          </div>

          <fieldset>
            <legend>Proposal (required)</legend>
            <label className="checkbox" htmlFor="proposalFile">
              <input id="proposalFile" type="radio" name="proposalMode" checked={proposalMode === 'file'} onChange={() => setProposalMode('file')} />
              Upload my proposal
            </label>
            <label className="checkbox" htmlFor="proposalOnline">
              <input id="proposalOnline" type="radio" name="proposalMode" checked={proposalMode === 'online'} onChange={() => setProposalMode('online')} />
              Fill in the supplier proposal form online
            </label>
          </fieldset>
          {proposalMode === 'file' ? (
            <>
              <label htmlFor="bidProposal">Proposal file</label>
              <input id="bidProposal" type="file" accept={acceptedDocumentExtensions} onChange={(event) => setProposal(event.target.files?.[0] ?? null)} />
            </>
          ) : proposalDefinitionQuery.data ? (
            <FormFields schema={proposalDefinitionQuery.data.parsedSchema} data={proposalData} onChange={setProposalData} idPrefix="proposal" />
          ) : (
            <Loading />
          )}

          <label htmlFor="bidSupporting">Supporting documents (optional)</label>
          <input id="bidSupporting" type="file" multiple accept={acceptedDocumentExtensions} onChange={(event) => setSupportingFiles(Array.from(event.target.files ?? []))} />
          <p className="small">{acceptedDocumentDescription} each.</p>

          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="actions">
            <button className="btn gold" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting…' : 'Submit sealed bid'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
