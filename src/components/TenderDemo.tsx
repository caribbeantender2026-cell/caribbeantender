/**
 * The home page hero's demo: the real pages with sample data, played as two scenarios with a pointer
 * clicking through them. A business posts and publishes a tender, then opens the bids and awards one; a
 * supplier finds that tender, bids and gets a sealed receipt, then sees the award. The demo itself is
 * inert (nothing in it can be clicked or focused, and screen readers get one label); only the two tabs
 * above it are real buttons. For people who turn animation off, each tab shows one still screen.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarIcon, ChevronDownIcon, FileTextIcon, LockIcon, MousePointer2Icon, type LucideIcon } from 'lucide-react';
import { classNames } from '../lib/classNames.ts';
import type { Enums } from '../lib/database.types.ts';
import { formatAmount } from '../lib/queries.ts';
import { bidStatusLabels, tenderPhaseDisplay, type TenderPhase } from '../lib/rules.ts';
import { formatJamaicaDateTime, formatTimeLeft } from '../lib/time.ts';
import type { RecordedDocument } from './DocumentList.tsx';
import { Notice } from './Notices.tsx';
import { BidReceipt, TenderView, useNow } from './TenderView.tsx';
import { Button } from './ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from './ui/card.tsx';
import { Label } from './ui/fields.tsx';

const millisecondsPerSecond = 1000;
const typingMillisecondsPerCharacter = 55;
// In the supplier's scenario the tender closes this long after the run starts, so its countdown ticks in seconds.
const demoClosesAfterSeconds = 47 * 60 + 30;
const demoBidSubmittedAfterSeconds = 9;
// The pointer tilts a degree for every this many pixels it travels sideways, up to the maximum.
const pixelsPerTiltDegree = 40;
const maximumTiltDegrees = 10;
// The tip of the pointer icon sits this far inside its 24-pixel box.
const pointerTipPixels = { x: 4, y: 5 };
// A click lands a little right of and below a target's centre, where a hand would put it.
const clickPointWithinTarget = { x: 0.6, y: 0.6 };
// Off-screen, the pointer waits just past the window's right edge, three quarters of the way down.
const outsidePoint = { marginPixels: 40, heightShare: 0.75 };
// Faint copies follow the pointer this much later, as a short motion trail.
const trailDelaysMilliseconds = [30, 60, 90];
const trailOpacities = [0.28, 0.16, 0.08];
// The burst strokes point left, up-left and up: away from the pointer's tip.
const burstAnglesDegrees = [180, 225, 270];

const demoTender = {
  title: 'Supply of 40 ergonomic office chairs',
  description:
    'Harbourview Hotels is refitting its head office in New Kingston and needs 40 ergonomic office chairs.\n\nEach chair must have adjustable height, lumbar support and armrests, and come with at least a 3-year warranty. Delivery to 12 Knutsford Boulevard within 30 days of award. Please quote a unit price and a total, including delivery and GCT.',
  cancelled_reason: null,
};
const demoBusinessName = 'Harbourview Hotels Ltd';
const demoCategoryName = 'Furniture & Fixtures';
const demoDocuments: RecordedDocument[] = [
  { id: 'demo-specification', file_name: 'Chair specification.pdf', document_role: 'supporting', size_bytes: 482_000 },
  { id: 'demo-floor-plan', file_name: 'Office floor plan.pdf', document_role: 'supporting', size_bytes: 1_240_000 },
];
// The supplier in the demo is Kingston Office Supply: it types this bid, and it wins.
const winningBid = { supplierName: 'Kingston Office Supply', amount: 980_000 };
const demoBids = [
  winningBid,
  { supplierName: 'Island Seating Co.', amount: 1_045_000 },
  { supplierName: 'Parade Furnishings Ltd', amount: 1_120_500 },
];
const otherOpenTenders = [
  { title: 'Security services for a Montego Bay warehouse', businessName: 'Northshore Logistics Ltd', categoryName: 'Security & Investigation Services', timeLeft: '4 days 6 hours' },
  { title: 'Office cleaning for the Half Way Tree branch', businessName: 'Seaview Credit Co-op', categoryName: 'Cleaning & Janitorial Services', timeLeft: '9 days 2 hours' },
];

type Flow = 'business' | 'supplier';
type Screen = 'post-form' | 'business-tender' | 'tender-list' | 'tender-page' | 'bid-page' | 'my-bids';
type Field = 'title' | 'category' | 'description' | 'closes-at' | 'amount';
type Target = Field | 'save-draft' | 'publish' | 'award' | 'tender-link' | 'submit-bid' | 'submit-sealed-bid';
type BusinessTenderPhase = 'draft' | 'published' | 'closed' | 'awarded';
/** One pointer move: where it goes, whether it clicks, and whether a field fills in (typed, or picked at once). */
type Move = { milliseconds: number; pointerAt?: Target | 'outside'; isClick?: boolean; fills?: 'typing' | 'at-once'; isStill?: boolean };
/** One screen of a scenario, with its caption and the pointer's moves while it shows. */
type Scene = { screen: Screen; caption: string; businessPhase?: BusinessTenderPhase; showsReceipt?: boolean; moves: Move[] };
type Step = Omit<Scene, 'moves'> & Move;

const fieldValues: Record<Field, string> = {
  title: demoTender.title,
  category: demoCategoryName,
  description: 'Harbourview Hotels is refitting its head office in New Kingston and needs 40 ergonomic office chairs.',
  'closes-at': '30 Nov 2026, 5:00 pm',
  amount: String(winningBid.amount),
};

// Each scenario as a script. A move takes 0.8 seconds of its step; isStill marks the screen shown when motion is off.
const businessScenes: Scene[] = [
  {
    screen: 'post-form',
    caption: 'A business posts a tender',
    moves: [
      { milliseconds: 1200, pointerAt: 'outside' },
      { milliseconds: 900, pointerAt: 'title' },
      { milliseconds: 300, pointerAt: 'title', isClick: true },
      { milliseconds: 2300, pointerAt: 'title', fills: 'typing' },
      { milliseconds: 900, pointerAt: 'category' },
      { milliseconds: 500, pointerAt: 'category', isClick: true, fills: 'at-once' },
      { milliseconds: 900, pointerAt: 'description' },
      { milliseconds: 500, pointerAt: 'description', isClick: true, fills: 'at-once' },
      { milliseconds: 900, pointerAt: 'closes-at' },
      { milliseconds: 500, pointerAt: 'closes-at', isClick: true, fills: 'at-once' },
      { milliseconds: 900, pointerAt: 'save-draft' },
      { milliseconds: 400, pointerAt: 'save-draft', isClick: true },
    ],
  },
  {
    screen: 'business-tender',
    businessPhase: 'draft',
    caption: 'The business publishes it',
    moves: [
      { milliseconds: 1000, pointerAt: 'publish' },
      { milliseconds: 400, pointerAt: 'publish', isClick: true },
    ],
  },
  { screen: 'business-tender', businessPhase: 'published', caption: 'Bids stay sealed until closing', moves: [{ milliseconds: 2600, pointerAt: 'outside' }] },
  {
    screen: 'business-tender',
    businessPhase: 'closed',
    caption: 'At closing, every bid opens at once',
    moves: [
      { milliseconds: 1500, pointerAt: 'award' },
      { milliseconds: 400, pointerAt: 'award', isClick: true },
    ],
  },
  { screen: 'business-tender', businessPhase: 'awarded', caption: 'The business awards the tender', moves: [{ milliseconds: 3000, isStill: true }] },
];
const supplierScenes: Scene[] = [
  {
    screen: 'tender-list',
    caption: 'A supplier finds a tender',
    moves: [
      { milliseconds: 1200, pointerAt: 'outside' },
      { milliseconds: 1000, pointerAt: 'tender-link' },
      { milliseconds: 400, pointerAt: 'tender-link', isClick: true },
    ],
  },
  {
    screen: 'tender-page',
    caption: 'The supplier reads it and bids',
    moves: [
      { milliseconds: 1100, pointerAt: 'submit-bid', isStill: true },
      { milliseconds: 400, pointerAt: 'submit-bid', isClick: true },
    ],
  },
  {
    screen: 'bid-page',
    caption: 'The supplier enters a sealed bid',
    moves: [
      { milliseconds: 900, pointerAt: 'amount' },
      { milliseconds: 300, pointerAt: 'amount', isClick: true },
      { milliseconds: 700, pointerAt: 'amount', fills: 'typing' },
      { milliseconds: 900, pointerAt: 'submit-sealed-bid' },
      { milliseconds: 400, pointerAt: 'submit-sealed-bid', isClick: true },
    ],
  },
  { screen: 'bid-page', showsReceipt: true, caption: 'A receipt, timed to the second', moves: [{ milliseconds: 2600 }] },
  { screen: 'my-bids', caption: 'Later, the supplier sees the award', moves: [{ milliseconds: 3000, pointerAt: 'outside' }] },
];

/** A scenario's scenes as one list of steps, each carrying its scene's screen and caption. */
function stepsOf(scenes: Scene[]): Step[] {
  return scenes.flatMap(({ moves, ...scene }) => moves.map((move) => ({ ...scene, ...move })));
}

const flows: Record<Flow, { label: string; steps: Step[]; next: Flow }> = {
  business: { label: 'For Businesses', steps: stepsOf(businessScenes), next: 'supplier' },
  supplier: { label: 'For Suppliers', steps: stepsOf(supplierScenes), next: 'business' },
};
// Never shown: a flow's step index always points into its steps. It only satisfies the type checker.
const fallbackStep: Step = { screen: 'tender-page', caption: '', milliseconds: millisecondsPerSecond };

const screenPaths: Record<Screen, string> = {
  'post-form': 'business/tenders/new',
  'business-tender': 'business/tenders/2f9c1a',
  'tender-list': 'tenders',
  'tender-page': 'tenders/2f9c1a',
  'bid-page': 'tenders/2f9c1a/bid',
  'my-bids': 'supplier',
};
const businessPhaseDisplay: Record<BusinessTenderPhase, TenderPhase> = { draft: 'draft', published: 'accepting-bids', closed: 'opened', awarded: 'awarded' };

// What the pointer's target looks like: it lifts a moment before the pointer arrives, then presses in on the click.
const pointerReaction =
  'transition-[scale,box-shadow,filter] duration-200 data-[demo-state=hover]:scale-[1.03] data-[demo-state=hover]:shadow-md data-[demo-state=hover]:delay-500 data-[demo-state=pressed]:scale-[0.97] data-[demo-state=pressed]:brightness-90';

/** Whether a target is under the pointer at this step: hovered while the pointer heads there, pressed on the click. */
function targetState(step: Step, target: Target): 'hover' | 'pressed' | undefined {
  if (step.pointerAt !== target) return undefined;
  return step.isClick ? 'pressed' : 'hover';
}

/** The props that make an element a pointer target with its hover and press reaction. */
function targetProps(step: Step, target: Target) {
  return { 'data-demo-target': target, 'data-demo-state': targetState(step, target) };
}

/** Where the pointer's tip goes for a target, relative to the window; null if the target isn't on screen. */
function pointerDestination(demoWindow: HTMLElement, target: Target | 'outside'): { x: number; y: number } | null {
  const windowBox = demoWindow.getBoundingClientRect();
  if (target === 'outside') return { x: windowBox.width + outsidePoint.marginPixels, y: windowBox.height * outsidePoint.heightShare };
  const element = demoWindow.querySelector(`[data-demo-target="${target}"]`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { x: box.left - windowBox.left + box.width * clickPointWithinTarget.x, y: box.top - windowBox.top + box.height * clickPointWithinTarget.y };
}

/** Whether the pointer's target is a form field the demo fills in. */
function isField(target: Target | 'outside' | undefined): target is Field {
  return target !== undefined && target in fieldValues;
}

/** The step a flow shows when motion is off. */
function stillStepIndex(flow: Flow): number {
  return Math.max(0, flows[flow].steps.findIndex((step) => step.isStill));
}

/** A bid's status in the demo: every bid waits until the award, then one wins. */
function demoBidStatus(isAwarded: boolean, isWinner: boolean): Enums<'bid_status'> {
  if (!isAwarded) return 'submitted';
  return isWinner ? 'awarded' : 'unsuccessful';
}

const headingClasses = 'text-2xl leading-tight font-semibold tracking-tight text-navy-dark';

/** A form field as the app draws it, showing what has been typed or picked so far. */
function DemoField({ step, field, label, shownText, trailingIcon: TrailingIcon, prefix, isMultiline = false }: {
  step: Step;
  field: Field;
  label: string;
  shownText: string;
  trailingIcon?: LucideIcon;
  prefix?: string;
  isMultiline?: boolean;
}) {
  const isFocused = step.pointerAt === field && (step.isClick === true || step.fills !== undefined);
  const isTyping = step.pointerAt === field && step.fills === 'typing';
  return (
    <div className="grid min-w-0 gap-2">
      <Label>{label}</Label>
      <div
        data-demo-target={field}
        className={classNames(
          'flex gap-2 rounded-md border bg-card px-3 text-sm shadow-xs transition-[border-color,box-shadow] duration-200',
          isMultiline ? 'min-h-16 items-start py-2' : 'h-10 items-center',
          isFocused ? 'border-ring ring-[3px] ring-ring/50' : 'border-input',
        )}
      >
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <span className={classNames('min-w-0 flex-1 tabular-nums', isMultiline ? 'line-clamp-2' : 'truncate')}>
          {shownText}
          {isTyping && <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />}
        </span>
        {TrailingIcon && <TrailingIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />}
      </div>
    </div>
  );
}

/** The business's "Post a tender" form, filling in as the pointer types and picks. */
function PostFormScreen({ step, shownText }: { step: Step; shownText: (field: Field) => string }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <h2 className={headingClasses}>Post a tender</h2>
      </CardHeader>
      <CardContent className="grid gap-4">
        <DemoField step={step} field="title" label="Title" shownText={shownText('title')} />
        <DemoField step={step} field="category" label="Category" shownText={shownText('category')} trailingIcon={ChevronDownIcon} />
        {/* Left out on phones, where the whole form wouldn't fit in the window. */}
        <div className="hidden min-w-0 sm:block">
          <DemoField step={step} field="description" label="Description" shownText={shownText('description')} isMultiline />
        </div>
        <DemoField step={step} field="closes-at" label="Closing date and time (Jamaica time)" shownText={shownText('closes-at')} trailingIcon={CalendarIcon} />
        <Button variant="outline" {...targetProps(step, 'save-draft')} className={classNames('w-full sm:w-auto sm:justify-self-start', pointerReaction)}>
          Save draft and add documents
        </Button>
      </CardContent>
    </Card>
  );
}

/** The bids on the business's tender after closing, each with its award button; then the award. */
function BidsList({ step, isAwarded }: { step: Step; isAwarded: boolean }) {
  return (
    <>
      <h3 className="mb-2 text-sm font-semibold text-navy-dark">Bids</h3>
      <ul className="divide-y rounded-lg border text-sm">
        {demoBids.map((bid) => {
          const isWinner = bid === winningBid;
          const status = demoBidStatus(isAwarded, isWinner);
          return (
            <li key={bid.supplierName} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{bid.supplierName}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{formatAmount(bid.amount)}</span>
              </span>
              {isAwarded ? (
                <span className={`badge ${status}`}>{bidStatusLabels[status]}</span>
              ) : (
                <Button size="sm" variant="outline" {...(isWinner ? targetProps(step, 'award') : {})} className={pointerReaction}>
                  Award to this bid
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The business's own tender: a draft to publish, then sealed while open, then its bids, then the award. */
function BusinessTenderScreen({ step }: { step: Step }) {
  const phase = step.businessPhase ?? 'draft';
  const display = tenderPhaseDisplay[businessPhaseDisplay[phase]];
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="gap-3">
        <span className={`badge ${display.badgeStyle} justify-self-start`}>{display.label}</span>
        <h2 className={headingClasses}>{demoTender.title}</h2>
        <CardDescription>Closes {fieldValues['closes-at']} Jamaica time</CardDescription>
      </CardHeader>
      <CardContent>
        {phase === 'draft' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Edit draft and documents</Button>
            <Button variant="gold" {...targetProps(step, 'publish')} className={pointerReaction}>
              Publish
            </Button>
          </div>
        )}
        {phase === 'published' && <Notice>Bids are sealed until the closing time. Not even the number of bids is shown before then.</Notice>}
        {(phase === 'closed' || phase === 'awarded') && <BidsList step={step} isAwarded={phase === 'awarded'} />}
      </CardContent>
    </Card>
  );
}

/** The supplier's "Open tenders" list, with the chairs tender among others. */
function TenderListScreen({ step, timeLeft }: { step: Step; timeLeft: string }) {
  const rows = [{ title: demoTender.title, businessName: demoBusinessName, categoryName: demoCategoryName, timeLeft }, ...otherOpenTenders];
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <h2 className={headingClasses}>Open tenders</h2>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((row) => (
            <li key={row.title} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-0">
                <span
                  {...(row.title === demoTender.title ? targetProps(step, 'tender-link') : {})}
                  className="block truncate font-medium text-primary underline-offset-4 data-[demo-state]:underline"
                >
                  {row.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {row.businessName}, {row.categoryName}
                </span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{row.timeLeft} left</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The supplier's bid page: the amount being typed, the proposal and the submit button; then the receipt. */
function BidScreen({ step, shownText, closesAt, submittedAt }: { step: Step; shownText: (field: Field) => string; closesAt: string; submittedAt: string }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader className="gap-2">
        <h2 className={headingClasses}>Bid: {demoTender.title}</h2>
        <CardDescription>Closes {formatJamaicaDateTime(closesAt)} Jamaica time.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {step.showsReceipt ? (
          <BidReceipt amount={winningBid.amount} currency="JMD" submittedAt={submittedAt} />
        ) : (
          <>
            <DemoField step={step} field="amount" label="Amount (Jamaican dollars, JMD)" shownText={shownText('amount')} prefix="J$" />
            <div className="grid gap-2">
              <Label>Proposal (required)</Label>
              <p className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {winningBid.supplierName} proposal.pdf
              </p>
            </div>
            <Button variant="gold" {...targetProps(step, 'submit-sealed-bid')} className={classNames('w-full sm:w-auto sm:justify-self-start', pointerReaction)}>
              Submit sealed bid
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The supplier's "My bids", where the award shows. */
function MyBidsScreen({ submittedAt }: { submittedAt: string }) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="gap-2">
        <h2 className={headingClasses}>My bids</h2>
        <CardDescription>Every bid you have submitted, with its receipt.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="font-semibold text-navy-dark">{demoTender.title}</span>
            <span className="badge awarded">{bidStatusLabels.awarded}</span>
          </div>
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="mt-0.5 text-lg font-semibold text-navy-dark tabular-nums">{formatAmount(winningBid.amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Receipt</dt>
              <dd className="mt-0.5 tabular-nums">Submitted {formatJamaicaDateTime(submittedAt, { withSeconds: true })} Jamaica time</dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The pointer and its trail. Sideways and up-down movement ease differently, so the pointer travels in a
 * slight arc, fast at first and settling at the end, like a hand on a mouse rather than a straight line.
 */
function DemoPointer({ x, y, tiltDegrees, isClick, stepKey }: { x: number; y: number; tiltDegrees: number; isClick: boolean; stepKey: string }) {
  const position = (delayMilliseconds: number) => ({
    across: { transform: `translateX(${x - pointerTipPixels.x}px)`, transitionDelay: `${delayMilliseconds}ms` },
    down: { transform: `translateY(${y - pointerTipPixels.y}px)`, transitionDelay: `${delayMilliseconds}ms` },
  });
  const acrossClasses = 'pointer-events-none absolute top-0 left-0 transition-transform duration-800 ease-[cubic-bezier(0.22,1,0.36,1)]';
  const downClasses = 'transition-transform duration-800 ease-[cubic-bezier(0.55,0,0.25,1)]';
  return (
    <>
      {trailDelaysMilliseconds.map((delayMilliseconds, index) => (
        <div key={delayMilliseconds} aria-hidden="true" className={acrossClasses} style={{ ...position(delayMilliseconds).across, opacity: trailOpacities[index] }}>
          <div className={downClasses} style={position(delayMilliseconds).down}>
            <MousePointer2Icon className="size-6 fill-navy-dark stroke-none" />
          </div>
        </div>
      ))}
      <div aria-hidden="true" className={acrossClasses} style={position(0).across}>
        <div className={downClasses} style={position(0).down}>
          <div key={stepKey} className="origin-top-left animate-pointer-tilt" style={{ '--pointer-tilt': `${tiltDegrees}deg` } as CSSProperties}>
            <div className={classNames('relative origin-top-left', isClick && 'animate-pointer-click')}>
              <MousePointer2Icon
                className={classNames('size-6 stroke-white drop-shadow-[0_3px_4px_rgb(0_23_58/0.35)] transition-[fill] duration-150', isClick ? 'fill-gold' : 'fill-navy-dark')}
              />
              {isClick &&
                burstAnglesDegrees.map((angleDegrees) => (
                  <span key={angleDegrees} className="absolute" style={{ left: pointerTipPixels.x, top: pointerTipPixels.y, rotate: `${angleDegrees}deg` }}>
                    <span className="block h-0.5 w-2 origin-left animate-click-burst rounded-full bg-gold" />
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function TenderDemo() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const now = useNow(!prefersReducedMotion);
  const [flow, setFlow] = useState<Flow>('business');
  const [stepIndex, setStepIndex] = useState(() => (prefersReducedMotion ? stillStepIndex('business') : 0));
  const [runStartedAt, setRunStartedAt] = useState(() => Date.now());
  const [typedLengths, setTypedLengths] = useState<Partial<Record<Field, number>>>({});
  // Starts far off to the right, so the first move is the pointer arriving from outside the window.
  const [pointer, setPointer] = useState({ x: 10_000, y: 300, tiltDegrees: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const step = flows[flow].steps[stepIndex] ?? fallbackStep;
  const atSecond = (second: number) => new Date(runStartedAt + second * millisecondsPerSecond).toISOString();
  const closesAt = atSecond(demoClosesAfterSeconds);
  const submittedAt = atSecond(demoBidSubmittedAfterSeconds);
  const shownText = (field: Field) => fieldValues[field].slice(0, typedLengths[field] ?? 0);

  /** Starts a flow from its beginning (or its still screen), with empty fields and a fresh countdown. */
  function startFlow(nextFlow: Flow) {
    setFlow(nextFlow);
    setStepIndex(prefersReducedMotion ? stillStepIndex(nextFlow) : 0);
    setTypedLengths({});
    setRunStartedAt(Date.now());
  }

  // Moves to the next step when this one's time is up; after a flow's last step, the other flow starts.
  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = window.setTimeout(() => {
      if (stepIndex + 1 < flows[flow].steps.length) setStepIndex(stepIndex + 1);
      else startFlow(flows[flow].next);
    }, step.milliseconds);
    return () => window.clearTimeout(timer);
    // startFlow only calls state setters, so it needn't restart the timer.
  }, [prefersReducedMotion, flow, stepIndex, step.milliseconds]);

  // Fills in the field under the pointer: typed one character at a time, or picked all at once.
  useEffect(() => {
    const field = step.pointerAt;
    if (step.fills === undefined || !isField(field)) return;
    const fullLength = fieldValues[field].length;
    if (step.fills === 'at-once') {
      setTypedLengths((lengths) => ({ ...lengths, [field]: fullLength }));
      return;
    }
    const timer = window.setInterval(
      () => setTypedLengths((lengths) => ({ ...lengths, [field]: Math.min((lengths[field] ?? 0) + 1, fullLength) })),
      typingMillisecondsPerCharacter,
    );
    return () => window.clearInterval(timer);
  }, [step]);

  // Sends the pointer to this step's target, measured once the step's screen is on the page.
  // ponytail: measured once per step; resizing the window mid-step leaves the pointer off target until the next step.
  useLayoutEffect(() => {
    const demoWindow = windowRef.current;
    if (!demoWindow || step.pointerAt === undefined) return;
    const destination = pointerDestination(demoWindow, step.pointerAt);
    if (!destination) return;
    setPointer((previous) => {
      const sidewaysTilt = (destination.x - previous.x) / pixelsPerTiltDegree;
      return { ...destination, tiltDegrees: Math.max(-maximumTiltDegrees, Math.min(maximumTiltDegrees, sidewaysTilt)) };
    });
  }, [step]);

  const screens: Record<Screen, () => ReactNode> = {
    'post-form': () => <PostFormScreen step={step} shownText={shownText} />,
    'business-tender': () => <BusinessTenderScreen step={step} />,
    'tender-list': () => <TenderListScreen step={step} timeLeft={formatTimeLeft(closesAt, now) ?? 'Closing'} />,
    'tender-page': () => (
      <TenderView
        tender={{ ...demoTender, status: 'open', closes_at: closesAt }}
        now={now}
        businessName={demoBusinessName}
        categoryName={demoCategoryName}
        documents={demoDocuments}
        sideCardFirstOnSmallScreens
        actions={
          <Button variant="gold" {...targetProps(step, 'submit-bid')} className={classNames('w-full', pointerReaction)}>
            Submit a bid
          </Button>
        }
      />
    ),
    'bid-page': () => <BidScreen step={step} shownText={shownText} closesAt={closesAt} submittedAt={submittedAt} />,
    'my-bids': () => <MyBidsScreen submittedAt={submittedAt} />,
  };

  return (
    <div className="mx-auto mt-14 w-full max-w-[1144px] lg:mt-[72px] lg:w-[88%]">
      <div role="group" aria-label="Demo scenario" className="mx-auto mb-4 flex w-fit gap-1 rounded-button border border-white/25 bg-white/10 p-1 backdrop-blur-md">
        {(Object.keys(flows) as Flow[]).map((flowName) => (
          <button
            key={flowName}
            type="button"
            aria-pressed={flow === flowName}
            onClick={() => startFlow(flowName)}
            className={classNames(
              'cursor-pointer rounded-button px-4 py-2 text-sm font-medium transition-colors duration-150',
              flow === flowName ? 'bg-white text-ink' : 'text-white/85 hover:bg-white/10 hover:text-white',
            )}
          >
            {flows[flowName].label}
          </button>
        ))}
      </div>
      <div
        role="img"
        aria-label={
          flow === 'business'
            ? 'A demo of CaribbeanTender with sample data: a business posts a tender and publishes it; the bids stay sealed until closing, then open at once, and the business awards the tender.'
            : 'A demo of CaribbeanTender with sample data: a supplier finds a tender, submits a sealed bid and gets a receipt, then sees that it won.'
        }
        // The frame, glass edges included, fades out before the hero ends, over the hero's solid paper, so no edge shows.
        className="rounded-t-2xl border border-b-0 border-white/25 bg-white/10 p-2 pb-0 shadow-[0_30px_80px_-20px_rgb(0_23_58/0.7)] backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_calc(100%-4.5rem),transparent_calc(100%-1rem))] sm:p-3 sm:pb-0"
      >
        <div ref={windowRef} className="relative h-[520px] overflow-hidden rounded-t-lg bg-background text-left text-foreground select-none sm:h-[640px]">
          <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
            <span className="hidden min-w-0 items-center gap-1.5 rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground sm:flex">
              <LockIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">caribbeantender.com/{screenPaths[step.screen]}</span>
            </span>
            <span key={step.caption} className="truncate text-xs text-muted-foreground motion-safe:animate-fade-in">
              <span className="font-medium text-navy-dark">Example:</span> {step.caption}
            </span>
          </div>
          <div key={`${flow}-${step.screen}`} inert className="px-4 pt-5 motion-safe:animate-fade-in sm:px-8 sm:pt-7">
            {screens[step.screen]()}
          </div>
          {!prefersReducedMotion && <DemoPointer {...pointer} isClick={step.isClick === true} stepKey={`${flow}-${stepIndex}`} />}
        </div>
      </div>
    </div>
  );
}
