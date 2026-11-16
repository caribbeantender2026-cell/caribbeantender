/**
 * One of the business's own tenders: its history and documents, and what may happen next (PRD P1-06,
 * P1-07, P1-09, P1-10). Drafts are edited, published or deleted; an open tender's closing time can only
 * be extended; open or closed tenders can be cancelled with a reason; bids show from the closing time.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DocumentList, type RecordedDocument } from '../../components/DocumentList.tsx';
import { AttachedForm } from '../../components/FormFields.tsx';
import type { FormData } from '../../lib/forms.ts';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { formatAmount } from '../../lib/queries.ts';
import { tenderPhase, tenderPhaseDisplay } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime, jamaicaLocalToUtc, utcToJamaicaLocal } from '../../lib/time.ts';
import { useTender } from '../TenderDetailsPage.tsx';
import { listDraftFiles } from './TenderFormPage.tsx';

const maximumReasonLength = 1000;

type BidDocument = { document_id: string; file_name: string; size_bytes: number; document_role: RecordedDocument['document_role'] };

/** Every bid with its supplier's name, readable from the closing time; the first read is logged as "bids opened". */
function Bids({ tenderId, canAward, onChanged }: { tenderId: string; canAward: boolean; onChanged: () => Promise<void> }) {
  const [problem, setProblem] = useState<string | null>(null);
  const bidsQuery = useQuery({
    queryKey: ['tender-bids', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('read_tender_bids', { tender_id: tenderId });
      if (error) throw error;
      return data;
    },
  });

  async function award(bidId: string, supplierName: string) {
    setProblem(null);
    if (!window.confirm(`Award this tender to ${supplierName}? Every other bid becomes unsuccessful. This can't be undone.`)) return;
    const { error } = await supabase.rpc('award_tender', { tender_id: tenderId, bid_id: bidId });
    if (error) return setProblem(errorMessage(error));
    await onChanged();
    await bidsQuery.refetch();
  }

  if (bidsQuery.isPending) return <Loading />;
  if (bidsQuery.isError) return <ErrorNotice error={bidsQuery.error} />;
  return (
    <>
      {bidsQuery.data.length === 0 && <p>No bids were submitted.</p>}
      {bidsQuery.data.map((bid) => (
        <div className="card" key={bid.bid_id}>
          <h4>{bid.supplier_company_name || 'Supplier'}</h4>
          <p>
            <strong>{formatAmount(bid.amount, bid.currency)}</strong> · submitted {formatJamaicaDateTime(bid.submitted_at, { withSeconds: true })} ·{' '}
            <span className={`badge ${bid.status}`}>{bid.status.replace('_', ' ')}</span>
          </p>
          <DocumentList
            documents={(bid.documents as BidDocument[]).map((document) => ({ ...document, id: document.document_id }))}
          />
          {bid.proposal_form !== null && (() => {
            const proposal = bid.proposal_form as { form_key: string; form_version: number; data: FormData };
            return <AttachedForm formKey={proposal.form_key} formVersion={proposal.form_version} data={proposal.data} notes={[`Proposal from ${bid.supplier_company_name || 'a supplier'}`]} />;
          })()}
          {canAward && (
            <button type="button" className="btn gold" onClick={() => void award(bid.bid_id, bid.supplier_company_name || 'this supplier')}>
              Award to this bid
            </button>
          )}
        </div>
      ))}
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}

export function TenderManagePage() {
  const tenderId = useParams().tenderId ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenderQuery = useTender(tenderId);
  const [problem, setProblem] = useState<string | null>(null);
  const [newClosesAt, setNewClosesAt] = useState('');
  const [reason, setReason] = useState('');

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tender', tenderId] });
    await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
  }

  /** Runs one lifecycle call; the database refuses anything the rules don't allow, with its own message. */
  async function act(call: () => PromiseLike<{ error: unknown }>) {
    setProblem(null);
    const { error } = await call();
    if (error) return setProblem(errorMessage(error));
    await refresh();
  }

  async function deleteDraft() {
    if (!window.confirm('Delete this draft and its uploaded files? This cannot be undone.')) return;
    setProblem(null);
    try {
      const files = await listDraftFiles(tenderId);
      const paths = [...files.supporting, ...files.requirements].map((file) => file.path);
      if (paths.length > 0) {
        const removed = await supabase.storage.from('tender-documents').remove(paths);
        if (removed.error) throw removed.error;
      }
    } catch (error) {
      return setProblem(errorMessage(error));
    }
    const { error } = await supabase.from('tenders').delete().eq('id', tenderId);
    if (error) return setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['own-tenders'] });
    void navigate('/business');
  }

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  const tender = tenderQuery.data.tender;
  if (!tender) return <Notice tone="error">Tender not found.</Notice>;

  const phase = tenderPhase(tender);
  const history: [string, string | null][] = [
    ['Created', tender.created_at],
    ['Published', tender.published_at],
    ['Closed', tender.closed_at],
    ['Awarded', tender.awarded_at],
    ['Cancelled', tender.cancelled_at],
  ];
  const bidsReadable = phase === 'awaiting-opening' || phase === 'opened' || phase === 'awarded' || (phase === 'cancelled' && tender.closed_at !== null);

  return (
    <>
      <h2>{tender.title}</h2>
      <div className="card">
        <p>
          <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>{' '}
          Closes {formatJamaicaDateTime(tender.closes_at)} Jamaica time
        </p>
        <h3>History</h3>
        <ul className="links">
          {history
            .filter(([, moment]) => moment !== null)
            .map(([label, moment]) => (
              <li key={label}>{label}: {formatJamaicaDateTime(moment ?? '')}</li>
            ))}
          {tender.cancelled_reason && <li className="preserve-lines">Reason: {tender.cancelled_reason}</li>}
        </ul>
        {phase !== 'draft' && (
          <>
            <h3>Documents</h3>
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
          <div className="actions">
            <Link className="btn" to={`/business/tenders/${tender.id}/edit`}>Edit draft and documents</Link>
            <button type="button" className="btn gold" onClick={() => void act(() => supabase.rpc('publish_tender', { tender_id: tender.id }))}>
              Publish
            </button>
            <button type="button" className="btn btn-outline" onClick={() => void deleteDraft()}>Delete draft</button>
          </div>
        )}

        {phase === 'accepting-bids' && (
          <form
            className="form"
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
            <label htmlFor="newClosesAt">Extend the closing time (Jamaica time). After publishing, this is the only change allowed.</label>
            <input id="newClosesAt" type="datetime-local" min={utcToJamaicaLocal(tender.closes_at)} value={newClosesAt} onChange={(event) => setNewClosesAt(event.target.value)} required />
            <button className="btn" type="submit">Extend</button>
          </form>
        )}

        {(phase === 'accepting-bids' || phase === 'awaiting-opening' || phase === 'opened') && (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!window.confirm('Cancel this tender? Suppliers can no longer bid, and this cannot be undone.')) return;
              void act(() => supabase.rpc('cancel_tender', { tender_id: tender.id, reason: reason.trim() }));
            }}
          >
            <label htmlFor="cancelReason">Reason for cancelling (shown to suppliers)</label>
            <textarea id="cancelReason" rows={3} maxLength={maximumReasonLength} value={reason} onChange={(event) => setReason(event.target.value)} required />
            <button className="btn btn-outline" type="submit" disabled={reason.trim() === ''}>Cancel tender</button>
          </form>
        )}
      </div>

      {phase === 'accepting-bids' && <Notice>Bids are sealed until the closing time. Not even the number of bids is shown before then.</Notice>}
      {bidsReadable && (
        <>
          <h3>Bids</h3>
          {phase === 'awaiting-opening' && <Notice>The tender is closing; you can award a bid within a minute.</Notice>}
          <Bids tenderId={tender.id} canAward={phase === 'opened'} onChanged={refresh} />
        </>
      )}
    </>
  );
}
