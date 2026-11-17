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
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Choice, Field, Input } from '../../components/ui/fields.tsx';
import type { Json } from '../../lib/database.types.ts';
import { formProblems, type FormData } from '../../lib/forms.ts';
import { acceptedDocumentDescription, acceptedDocumentExtensions, bidDocumentPath, bidUploadRule, checkDocument, sameStoredName, uploadProblem } from '../../lib/documents.ts';
import { formatAmount, useOwnSubscription } from '../../lib/queries.ts';
import { subscriptionPrices, supplierHasAccess, tenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase, supportEmail } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';
import { useTender } from '../TenderDetailsPage.tsx';

// Matches submit_bid: above zero, below 10^12 (numeric(14,2)), at most two decimal places.
const maximumAmount = 1_000_000_000_000;
const amountPattern = /^\d+(\.\d{1,2})?$/;
// Postgres's "unique_violation": the one bid per supplier per tender already exists.
const uniqueViolationCode = '23505';
// The client's Bid Submission Form repeats the bid amount here; filled in online, it must match
// (Rockell, 17 Nov 2026). submit_bid checks the same field.
const formTotalField = 'total_bid_value';

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
  // What this page has put in the bid's folder, by path: submit_bid records every file found there.
  const uploadedFiles = useRef(new Map<string, File>());
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

  /**
   * Makes the bid's folder hold exactly the chosen files, even after a failed attempt: a file from an
   * earlier attempt that is no longer chosen (or was chosen again) is removed, and each file uploads once.
   */
  async function syncBidFiles(chosen: { file: File; isProposal: boolean }[]) {
    const bucket = supabase.storage.from('bid-documents');
    const wanted = new Map(chosen.map(({ file, isProposal }) => [bidDocumentPath(tenderId, bidId, file.name, isProposal), file]));
    const stalePaths = [...uploadedFiles.current].filter(([path, file]) => wanted.get(path) !== file).map(([path]) => path);
    if (stalePaths.length > 0) {
      const removed = await bucket.remove(stalePaths);
      if (removed.error) throw new Error(`A file from your earlier attempt could not be removed: ${removed.error.message}`);
      for (const path of stalePaths) uploadedFiles.current.delete(path);
    }
    for (const [path, file] of wanted) {
      if (uploadedFiles.current.get(path) === file) continue;
      const checked = checkDocument(file);
      if ('problem' in checked) throw new Error(checked.problem);
      let { error } = await bucket.upload(path, file, { contentType: checked.contentType });
      if (error?.message.includes('already exists')) {
        // An earlier attempt reached storage but its answer was lost on the way back; replace that copy.
        await bucket.remove([path]);
        ({ error } = await bucket.upload(path, file, { contentType: checked.contentType }));
      }
      if (error) throw new Error(uploadProblem(file.name, error, bidUploadRule));
      uploadedFiles.current.set(path, file);
    }
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
    if (tender && tenderPhase(tender) !== 'accepting-bids') {
      return setProblem(`This tender closed at ${formatJamaicaDateTime(tender.closes_at)} Jamaica time, so it no longer takes bids.`);
    }
    const proposalSchema = proposalDefinitionQuery.data?.parsedSchema;
    if (proposalMode === 'file' && !proposal) return setProblem('Attach your proposal.');
    const repeatedName = sameStoredName(supportingFiles.map((file) => file.name));
    if (repeatedName) return setProblem(`"${repeatedName}" would be stored under the same name as another supporting document. Rename one of them and choose the files again.`);
    if (proposalMode === 'online') {
      const problems = formProblems(proposalSchema ?? { fields: [] }, proposalData, true);
      if (!proposalSchema || problems.length > 0) return setProblem(problems.join(' ') || 'The proposal form is not available.');
      const formTotal = proposalData[formTotalField];
      if (typeof formTotal === 'number' && formTotal !== amount) {
        return setProblem(`The total bid value in the proposal form (${formatAmount(formTotal)}) must match your bid amount (${formatAmount(amount)}). Change one so they match.`);
      }
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
      const proposalFile = proposalMode === 'file' && proposal ? [{ file: proposal, isProposal: true }] : [];
      await syncBidFiles([...proposalFile, ...supportingFiles.map((file) => ({ file, isProposal: false }))]);
      const proposalFormId = proposalMode === 'online' ? await saveProposalForm() : undefined;
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
      const isDuplicateBid = typeof error === 'object' && error !== null && 'code' in error && error.code === uniqueViolationCode;
      if (isDuplicateBid) {
        // Another tab sent this supplier's bid first; show its receipt.
        await queryClient.invalidateQueries({ queryKey: ['own-bid', tenderId, supplierId] });
        return;
      }
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
      <Card className="max-w-3xl">
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            noValidate
          >
            <Field label="Amount (Jamaican dollars, JMD)" htmlFor="bidAmount">
              <div className="flex">
                <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-semibold text-navy-dark">J$</span>
                <Input id="bidAmount" inputMode="decimal" className="rounded-l-none" value={amountText} onChange={(event) => setAmountText(event.target.value)} required />
              </div>
            </Field>

            <fieldset className="rounded-md border px-4 pt-1 pb-3">
              <legend className="px-1 text-sm font-medium">Proposal (required)</legend>
              <Choice className="mt-3" id="proposalFile" type="radio" name="proposalMode" checked={proposalMode === 'file'} onChange={() => setProposalMode('file')}>
                Upload my proposal
              </Choice>
              <Choice className="mt-3" id="proposalOnline" type="radio" name="proposalMode" checked={proposalMode === 'online'} onChange={() => setProposalMode('online')}>
                Fill in the supplier proposal form online
              </Choice>
            </fieldset>
            {proposalMode === 'file' ? (
              <Field label="Proposal file" htmlFor="bidProposal">
                <Input id="bidProposal" type="file" accept={acceptedDocumentExtensions} onChange={(event) => setProposal(event.target.files?.[0] ?? null)} />
              </Field>
            ) : proposalDefinitionQuery.isError ? (
              <ErrorNotice error={proposalDefinitionQuery.error} />
            ) : proposalDefinitionQuery.isPending ? (
              <Loading />
            ) : proposalDefinitionQuery.data ? (
              <FormFields schema={proposalDefinitionQuery.data.parsedSchema} data={proposalData} onChange={setProposalData} idPrefix="proposal" />
            ) : (
              <Notice tone="error">The online proposal form isn't available. Upload your proposal as a file instead.</Notice>
            )}

            <Field label="Supporting documents (optional)" htmlFor="bidSupporting" hint={`${acceptedDocumentDescription} each.`}>
              <Input id="bidSupporting" type="file" multiple accept={acceptedDocumentExtensions} onChange={(event) => setSupportingFiles(Array.from(event.target.files ?? []))} />
            </Field>

            {problem && <Notice tone="error">{problem}</Notice>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="gold" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting…' : 'Submit sealed bid'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
