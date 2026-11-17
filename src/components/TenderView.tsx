/** A tender's two cards, shared by the tender page and the home page's live example so the two never drift apart. */
import { useEffect, useState, type ReactNode } from 'react';
import { Building2Icon, CalendarClockIcon, LockKeyholeIcon, TagIcon } from 'lucide-react';
import type { Tables } from '../lib/database.types.ts';
import { tenderPhase, tenderPhaseDisplay } from '../lib/rules.ts';
import { formatJamaicaDateTime, formatTimeLeft } from '../lib/time.ts';
import { DocumentList, type RecordedDocument } from './DocumentList.tsx';
import { Notice } from './Notices.tsx';
import { Badge } from './ui/badge.tsx';
import { Card, CardContent, CardDescription, CardHeader } from './ui/card.tsx';

const countdownTickMilliseconds = 1000;

/** The current time, updated every second while ticking, for a live countdown. */
export function useNow(isTicking = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!isTicking) return;
    const timer = window.setInterval(() => setNow(new Date()), countdownTickMilliseconds);
    return () => window.clearInterval(timer);
  }, [isTicking]);
  return now;
}

type TenderViewProps = {
  tender: Pick<Tables<'tenders'>, 'title' | 'description' | 'status' | 'closes_at' | 'cancelled_reason'>;
  now: Date;
  businessName: string;
  categoryName: string;
  documents: RecordedDocument[];
  /** The requirements form, shown under the documents when the tender has one. */
  requirementsForm?: ReactNode;
  /** The buttons in the side card, such as "Submit a bid". */
  actions?: ReactNode;
};

/** Details and documents in the main card; the closing time, with a countdown while bids are open, in the side card. */
export function TenderView({ tender, now, businessName, categoryName, documents, requirementsForm, actions }: TenderViewProps) {
  const phase = tenderPhase(tender, now);
  const timeLeft = formatTimeLeft(tender.closes_at, now);
  const showsCountdown = phase === 'accepting-bids' && timeLeft !== null;
  return (
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
          <DocumentList documents={documents} />
          {requirementsForm}
        </CardContent>
      </Card>
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardDescription>{showsCountdown ? 'Closes in' : 'Closing time'}</CardDescription>
          <p className="text-2xl font-semibold tracking-tight text-navy-dark tabular-nums" aria-live="off">
            {showsCountdown ? timeLeft : tenderPhaseDisplay[phase].label}
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
          {actions}
          <p className="flex items-start gap-2.5 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            <LockKeyholeIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Bids stay sealed until the closing time. Nobody, not even the business, can see them before then.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
