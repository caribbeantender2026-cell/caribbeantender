/** One tender for signed-in users: details, closing time with a countdown, and its documents (PRD P1-05). */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeftIcon, Building2Icon, CalendarClockIcon, LockKeyholeIcon, TagIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { DocumentList } from '../components/DocumentList.tsx';
import { AttachedForm } from '../components/FormFields.tsx';
import type { FormData } from '../lib/forms.ts';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from '../components/ui/card.tsx';
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
  const categoryName = categoriesQuery.data?.find((category) => category.id === tender.category_id)?.name ?? 'Uncategorised';

  const isAcceptingBids = phase === 'accepting-bids';
  const businessName = namesQuery.data?.get(tender.business_id) ?? 'Business';
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
        <Link to="/tenders">
          <ArrowLeftIcon aria-hidden="true" />
          Back to open tenders
        </Link>
      </Button>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${tenderPhaseDisplay[phase].badgeStyle}`}>{tenderPhaseDisplay[phase].label}</span>
              <Badge variant="outline" className="font-normal">{categoryName}</Badge>
            </div>
            <h2 className="text-2xl leading-tight font-semibold tracking-tight text-navy-dark sm:text-3xl">{tender.title}</h2>
            <CardDescription>Posted by {businessName}</CardDescription>
          </CardHeader>
          <CardContent>
            {tender.cancelled_reason && (
              <Notice tone="error">Cancelled: {tender.cancelled_reason}</Notice>
            )}
            <h3 className="text-sm font-semibold text-navy-dark">Description</h3>
            <p className="mt-2 leading-relaxed whitespace-pre-line">{tender.description}</p>
            <hr className="my-6" />
            <h3 className="mb-1 text-sm font-semibold text-navy-dark">Documents</h3>
            <DocumentList documents={tenderQuery.data?.documents ?? []} />
            {tenderQuery.data?.requirementsForm && (
              <AttachedForm
                formKey={tenderQuery.data.requirementsForm.form_key}
                formVersion={tenderQuery.data.requirementsForm.form_version}
                data={tenderQuery.data.requirementsForm.data as FormData}
                notes={[`Requirements form for the tender "${tender.title}"`]}
              />
            )}
          </CardContent>
        </Card>
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardDescription>{isAcceptingBids && timeLeft ? 'Closes in' : 'Closing time'}</CardDescription>
            <p className="text-2xl font-semibold tracking-tight text-navy-dark tabular-nums" aria-live="off">
              {isAcceptingBids && timeLeft ? timeLeft : tenderPhaseDisplay[phase].label}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Closes</dt>
                <dd className="tabular-nums">{formatJamaicaDateTime(tender.closes_at)} Jamaica time</dd>
              </div>
              <div className="flex items-start gap-3">
                <Building2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Business</dt>
                <dd>{businessName}</dd>
              </div>
              <div className="flex items-start gap-3">
                <TagIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Category</dt>
                <dd>{categoryName}</dd>
              </div>
            </dl>
            {isOwner && (
              <Button asChild className="w-full">
                <Link to={`/business/tenders/${tender.id}`}>Manage this tender</Link>
              </Button>
            )}
            {!isOwner && supplierProfile && isAcceptingBids && (
              <Button asChild variant="gold" className="w-full">
                <Link to={`/tenders/${tender.id}/bid`}>Submit a bid</Link>
              </Button>
            )}
            <p className="flex items-start gap-2.5 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              <LockKeyholeIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Bids stay sealed until the closing time. Nobody, not even the business, can see them before then.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
