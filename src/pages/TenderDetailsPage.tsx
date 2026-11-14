/** One tender for signed-in users: details, closing time with a countdown, and its documents (PRD P1-05). */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { DocumentList } from '../components/DocumentList.tsx';
import { AttachedForm } from '../components/FormFields.tsx';
import type { FormData } from '../lib/forms.ts';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import { useCategories, useCompanyNames } from '../lib/queries.ts';
import { tenderPhase, tenderPhaseDisplay } from '../lib/rules.ts';
import { supabase } from '../lib/supabase.ts';
import { formatJamaicaDateTime, formatTimeLeft } from '../lib/time.ts';

const countdownTickMilliseconds = 1000;

/** The current time, updated every second, for a live countdown. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), countdownTickMilliseconds);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** A tender and its recorded documents, as the signed-in user may see them. */
export function useTender(tenderId: string) {
  return useQuery({
    queryKey: ['tender', tenderId],
    queryFn: async () => {
      const [tenderResult, documentsResult, formResult] = await Promise.all([
        supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle(),
        supabase.from('tender_documents').select('id, file_name, document_role, size_bytes').eq('tender_id', tenderId).order('file_name'),
        supabase.from('form_submissions').select('form_key, form_version, data').eq('attached_to_type', 'tender').eq('attached_to_id', tenderId).maybeSingle(),
      ]);
      if (tenderResult.error) throw tenderResult.error;
      if (documentsResult.error) throw documentsResult.error;
      if (formResult.error) throw formResult.error;
      return { tender: tenderResult.data, documents: documentsResult.data, requirementsForm: formResult.data };
    },
  });
}

export function TenderDetailsPage() {
  const tenderId = useParams().tenderId ?? '';
  const { session, supplierProfile } = useAccount();
  const now = useNow();
  const tenderQuery = useTender(tenderId);
  const tender = tenderQuery.data?.tender ?? null;
  const namesQuery = useCompanyNames(tender ? [tender.business_id] : []);
  const categoriesQuery = useCategories();

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (!tender) return <Notice tone="error">Tender not found. It may have been removed, or it isn't published yet.</Notice>;

  const phase = tenderPhase(tender, now);
  const isOwner = tender.business_id === session?.user.id;
  const timeLeft = formatTimeLeft(tender.closes_at, now);
  const categoryName = categoriesQuery.data?.find((category) => category.id === tender.category_id)?.name ?? '—';

  return (
    <>
      <h2>{tender.title}</h2>
      <div className="card">
        <p>
          <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>
        </p>
        <dl className="details">
          <dt>Business</dt>
          <dd>{namesQuery.data?.get(tender.business_id) ?? '—'}</dd>
          <dt>Category</dt>
          <dd>{categoryName}</dd>
          <dt>Closes</dt>
          <dd>
            {formatJamaicaDateTime(tender.closes_at)} Jamaica time
            {timeLeft && phase === 'accepting-bids' && <> (<span aria-live="off">{timeLeft} left</span>)</>}
          </dd>
          {tender.cancelled_reason && (
            <>
              <dt>Cancelled because</dt>
              <dd className="preserve-lines">{tender.cancelled_reason}</dd>
            </>
          )}
        </dl>
        <h3>Description</h3>
        <p className="preserve-lines">{tender.description}</p>
        <h3>Documents</h3>
        <DocumentList documents={tenderQuery.data?.documents ?? []} />
        {tenderQuery.data?.requirementsForm && (
          <AttachedForm
            formKey={tenderQuery.data.requirementsForm.form_key}
            formVersion={tenderQuery.data.requirementsForm.form_version}
            data={tenderQuery.data.requirementsForm.data as FormData}
            notes={[`Requirements form for the tender "${tender.title}"`]}
          />
        )}
        <div className="actions">
          {isOwner && <Link className="btn" to={`/business/tenders/${tender.id}`}>Manage this tender</Link>}
          {!isOwner && supplierProfile && phase === 'accepting-bids' && (
            <Link className="btn gold" to={`/tenders/${tender.id}/bid`}>Submit a bid</Link>
          )}
          <Link className="btn outline" to="/tenders">Back to open tenders</Link>
        </div>
      </div>
    </>
  );
}
