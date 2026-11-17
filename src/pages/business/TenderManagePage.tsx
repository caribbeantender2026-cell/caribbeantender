/**
 * One of the business's own tenders: its history and documents, and what may happen next (PRD P1-06,
 * P1-07, P1-09, P1-10). Drafts are edited, published or deleted; an open tender's closing time can only
 * be extended; open or closed tenders can be cancelled with a reason; bids show from the closing time.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { AccountPicture } from '../../components/AccountPicture.tsx';
import { useNow } from '../../components/TenderView.tsx';
import { DocumentList, type RecordedDocument } from '../../components/DocumentList.tsx';
import { AttachedForm } from '../../components/FormFields.tsx';
import type { FormData } from '../../lib/forms.ts';
import { useConfirmation } from '../../components/ConfirmDialog.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, Textarea } from '../../components/ui/fields.tsx';
import { formatAmount, useCompanies } from '../../lib/queries.ts';
import { tenderPhase, tenderPhaseDisplay, type TenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime, jamaicaLocalToUtc, utcToJamaicaLocal } from '../../lib/time.ts';
import { tenderServerTime, useTender } from '../TenderDetailsPage.tsx';

const maximumReasonLength = 1000;
const sectionHeadingClasses = 'mt-6 mb-3 text-base font-semibold text-navy-dark';

// What the business can do next, in plain words, for each phase of its tender.
const phaseGuidance: Record<TenderPhase, string> = {
  draft: 'A draft: only you can see it. Edit it and attach the requirements form, then publish it to open it for bids.',
  'accepting-bids': 'Open for bids until the closing time. Bids stay sealed until then; you can only extend the closing time or cancel.',
  'awaiting-opening': 'The closing time has passed. The bids open within a minute.',
  opened: 'Closed. Every bid is below. Award the one you choose; the others are marked unsuccessful.',
  awarded: 'Awarded. The winning bid and the others are below.',
  cancelled: 'Cancelled. Suppliers see the reason you gave.',
};

type BidDocument = { document_id: string; file_name: string; size_bytes: number; document_role: RecordedDocument['document_role'] };

/** Every bid with its supplier's name, readable from the closing time; the first read is logged as "bids opened". */
function Bids({ tenderId, tenderStatus, canAward, onChanged }: { tenderId: string; tenderStatus: string; canAward: boolean; onChanged: () => Promise<void> }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [isAwarding, setIsAwarding] = useState(false);
  const [confirmation, askToConfirm] = useConfirmation();
  const bidsQuery = useQuery({
    // Keyed by the tender's status too: a "still sealed" answer from a fast device clock is asked again
    // once the tender closes, and a cancel or award shows the bids' new statuses.
    queryKey: ['tender-bids', tenderId, tenderStatus],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('read_tender_bids', { tender_id: tenderId });
      if (error) throw error;
      return data;
    },
  });
  const suppliersQuery = useCompanies((bidsQuery.data ?? []).map((bid) => bid.supplier_id), 'supplier');

  async function award(bidId: string, supplierName: string) {
    setProblem(null);
    const { isConfirmed } = await askToConfirm({
      title: `Award this tender to ${supplierName}?`,
      message: "Every other bid becomes unsuccessful. This can't be undone.",
      confirmLabel: 'Award the tender',
      tone: 'go-ahead',
    });
    if (!isConfirmed) return;
    setIsAwarding(true);
    try {
      const { error } = await supabase.rpc('award_tender', { tender_id: tenderId, bid_id: bidId });
      if (error) return setProblem(errorMessage(error));
      await onChanged();
    } finally {
      setIsAwarding(false);
    }
  }

  if (bidsQuery.isPending) return <Loading />;
  if (bidsQuery.isError) return <ErrorNotice error={bidsQuery.error} />;
  return (
    <>
      {confirmation}
      {bidsQuery.data.length === 0 && <p>No bids were submitted.</p>}
      {bidsQuery.data.map((bid) => (
        <Card className="mb-6" key={bid.bid_id}>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <AccountPicture picturePath={suppliersQuery.data?.get(bid.supplier_id)?.picturePath} />
              <h4 className="font-semibold">{bid.supplier_company_name || 'Supplier'}</h4>
            </div>
          </CardHeader>
          <CardContent>
            <p>
              <strong>{formatAmount(bid.amount, bid.currency)}</strong> · submitted {formatJamaicaDateTime(bid.submitted_at, { withSeconds: true })} ·{' '}
              <Badge variant={bid.status}>{bid.status.replace('_', ' ')}</Badge>
            </p>
            <DocumentList
              documents={(bid.documents as BidDocument[]).map((document) => ({ ...document, id: document.document_id }))}
            />
            {bid.proposal_form !== null && (() => {
              const proposal = bid.proposal_form as { form_key: string; form_version: number; data: FormData };
              return <AttachedForm formKey={proposal.form_key} formVersion={proposal.form_version} data={proposal.data} notes={[`Proposal from ${bid.supplier_company_name || 'a supplier'}`]} />;
            })()}
            {canAward && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button type="button" variant="gold" disabled={isAwarding} onClick={() => void award(bid.bid_id, bid.supplier_company_name || 'this supplier')}>
                  Award to this bid
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}

export function TenderManagePage() {
  const tenderId = useParams().tenderId ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAccount();
  // Re-rendered every second, so the page moves from "open" to "closing" at the closing time by itself.
  useNow();
  const tenderQuery = useTender(tenderId);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [newClosesAt, setNewClosesAt] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, askToConfirm] = useConfirmation();

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tender', tenderId] });
    await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
    // Publishing and cancelling change which tenders are open.
    await queryClient.invalidateQueries({ queryKey: ['open-tenders'] });
  }

  /** Runs one lifecycle call; the database refuses anything the rules don't allow, with its own message. */
  async function act(call: () => PromiseLike<{ error: unknown }>) {
    setProblem(null);
    setIsBusy(true);
    try {
      const { error } = await call();
      if (error) return setProblem(errorMessage(error));
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteDraft() {
    const { isConfirmed } = await askToConfirm({
      title: 'Delete this draft?',
      message: "Its uploaded files are deleted too. This can't be undone.",
      confirmLabel: 'Delete draft',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!isConfirmed) return;
    setProblem(null);
    setIsBusy(true);
    try {
      // Only drafts can be deleted; one published meanwhile (in another tab) matches no row.
      const deleted = await supabase.from('tenders').delete().eq('id', tenderId).select('id');
      if (deleted.error) throw deleted.error;
      if (deleted.data.length === 0) {
        await refresh();
        return setProblem('Nothing was deleted: this tender is no longer a draft.');
      }
    } catch (error) {
      return setProblem(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
    await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
    void navigate('/business');
  }

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  const tender = tenderQuery.data.tender;
  // Anyone signed in can read a published tender; only its business manages it.
  if (!tender || tender.business_id !== session?.user.id) return <Notice tone="error">Tender not found.</Notice>;

  const phase = tenderPhase(tender, tenderServerTime(tenderQuery.data));
  const history: [string, string | null][] = [
    ['Created', tender.created_at],
    ['Published', tender.published_at],
    ['Closed', tender.closed_at],
    ['Awarded', tender.awarded_at],
    ['Cancelled', tender.cancelled_at],
  ];
  // The same rule as private.bids_are_open: bids open at the closing time, unless cancelled before it.
  const wasCancelledBeforeClosing = tender.cancelled_at !== null && new Date(tender.cancelled_at) < new Date(tender.closes_at);
  const bidsReadable = phase === 'awaiting-opening' || phase === 'opened' || phase === 'awarded' || (phase === 'cancelled' && !wasCancelledBeforeClosing);

  return (
    <>
      <PageHeader title={tender.title} description={phaseGuidance[phase]} back={{ to: '/business', label: 'My tenders' }} />
      {confirmation}
      <Card className="mb-6">
        <CardContent>
          <p>
            <Badge variant={tenderPhaseDisplay[phase].badgeStyle}>{tenderPhaseDisplay[phase].label}</Badge>{' '}
            Closes {formatJamaicaDateTime(tender.closes_at)} Jamaica time
          </p>
          <h3 className={sectionHeadingClasses}>History</h3>
          <ul className="divide-y">
            {history
              .filter(([, moment]) => moment !== null)
              .map(([label, moment]) => (
                <li key={label} className="py-3">{label}: {formatJamaicaDateTime(moment ?? '')}</li>
              ))}
            {tender.cancelled_reason && <li className="py-3 whitespace-pre-line">Reason: {tender.cancelled_reason}</li>}
          </ul>
          {phase !== 'draft' && (
            <>
              <h3 className={sectionHeadingClasses}>Documents</h3>
              <DocumentList documents={tenderQuery.data.documents} />
            </>
          )}
          {tenderQuery.data.requirementsForm && (
            <AttachedForm
              formKey={tenderQuery.data.requirementsForm.form_key}
              formVersion={tenderQuery.data.requirementsForm.form_version}
              data={tenderQuery.data.requirementsForm.data as FormData}
              notes={[`Requirements form for the tender "${tender.title}"`]}
            />
          )}
          {problem && <Notice tone="error">{problem}</Notice>}

          {phase === 'draft' && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link to={`/business/tenders/${tender.id}/edit`}>Edit draft and documents</Link>
              </Button>
              <Button
                type="button"
                variant="gold"
                disabled={isBusy}
                onClick={async () => {
                  const { isConfirmed } = await askToConfirm({
                    title: 'Publish this tender?',
                    message: 'Suppliers can see it and bid, and those in its category get an email. After publishing you can only extend the closing time or cancel it.',
                    confirmLabel: 'Publish',
                    cancelLabel: 'Not yet',
                    tone: 'go-ahead',
                  });
                  if (isConfirmed) void act(() => supabase.rpc('publish_tender', { tender_id: tender.id }));
                }}
              >
                Publish
              </Button>
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => void deleteDraft()}>Delete draft</Button>
            </div>
          )}

          {phase === 'accepting-bids' && (
            <form
              className="mt-6 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                let closesAt: string;
                try {
                  closesAt = jamaicaLocalToUtc(newClosesAt);
                } catch (error) {
                  return setProblem(errorMessage(error));
                }
                void act(() => supabase.rpc('extend_tender_closing_time', { tender_id: tender.id, new_closes_at: closesAt }));
              }}
            >
              <Field label="Extend the closing time (Jamaica time). After publishing, this is the only change allowed." htmlFor="newClosesAt">
                <Input id="newClosesAt" type="datetime-local" min={utcToJamaicaLocal(tender.closes_at)} value={newClosesAt} onChange={(event) => setNewClosesAt(event.target.value)} required />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isBusy}>Extend</Button>
              </div>
            </form>
          )}

          {(phase === 'accepting-bids' || phase === 'awaiting-opening' || phase === 'opened') && (
            <form
              className="mt-6 grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const { isConfirmed } = await askToConfirm({
                  title: 'Cancel this tender?',
                  message: "Suppliers can no longer bid, and they see your reason. This can't be undone.",
                  confirmLabel: 'Cancel tender',
                  cancelLabel: 'Keep it open',
                  tone: 'danger',
                });
                if (isConfirmed) void act(() => supabase.rpc('cancel_tender', { tender_id: tender.id, reason: reason.trim() }));
              }}
            >
              <Field label="Reason for cancelling (shown to suppliers)" htmlFor="cancelReason">
                <Textarea id="cancelReason" rows={3} maxLength={maximumReasonLength} value={reason} onChange={(event) => setReason(event.target.value)} required />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="outline" disabled={isBusy || reason.trim() === ''}>Cancel tender</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {phase === 'accepting-bids' && <Notice>Bids are sealed until the closing time. Not even the number of bids is shown before then.</Notice>}
      {bidsReadable && (
        <>
          <h3 className="mb-3 text-base font-semibold text-navy-dark">Bids</h3>
          {phase === 'awaiting-opening' && <Notice>The tender is closing; you can award a bid within a minute.</Notice>}
          <Bids tenderId={tender.id} tenderStatus={tender.status} canAward={phase === 'opened'} onChanged={refresh} />
        </>
      )}
    </>
  );
}
