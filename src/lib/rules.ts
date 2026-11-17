/**
 * The app's view of the database rules, used only to decide what to show. The database enforces
 * every rule itself; these mirror them so the screen matches what the database will allow.
 */
import type { Enums, Tables } from './database.types.ts';

/** The badge colour for a tender phase; each is a variant of the Badge component. */
export type PhaseBadge = 'draft' | 'open' | 'waiting' | 'closed' | 'awarded' | 'cancelled';

/** Where a tender stands for bidding and for its sealed bids. */
export type TenderPhase = 'draft' | 'accepting-bids' | 'awaiting-opening' | 'opened' | 'awarded' | 'cancelled';

/** A short label and badge style for each phase. */
export const tenderPhaseDisplay: Record<TenderPhase, { label: string; badgeStyle: PhaseBadge }> = {
  draft: { label: 'Draft', badgeStyle: 'draft' },
  'accepting-bids': { label: 'Open', badgeStyle: 'open' },
  // The close job sets "closed" within a minute of closes_at (OPEN_QUESTIONS.md, item 26).
  'awaiting-opening': { label: 'Closing…', badgeStyle: 'waiting' },
  opened: { label: 'Closed', badgeStyle: 'closed' },
  awarded: { label: 'Awarded', badgeStyle: 'awarded' },
  cancelled: { label: 'Cancelled', badgeStyle: 'cancelled' },
};

/** A short label for each bid status; the status itself is the badge style. */
export const bidStatusLabels: Record<Enums<'bid_status'>, string> = {
  submitted: 'Submitted',
  awarded: 'Awarded',
  unsuccessful: 'Unsuccessful',
  tender_cancelled: 'Tender cancelled',
};

/**
 * Works out a tender's phase at a given moment. Bids are accepted while the tender is open and
 * before closes_at; they are readable by the business only once the tender has been closed.
 */
export function tenderPhase(
  tender: { status: Enums<'tender_status'>; closes_at: string },
  now: Date = new Date(),
): TenderPhase {
  switch (tender.status) {
    case 'draft':
      return 'draft';
    case 'cancelled':
      return 'cancelled';
    case 'awarded':
      return 'awarded';
    case 'closed':
      return 'opened';
    case 'open':
      return new Date(tender.closes_at).getTime() > now.getTime() ? 'accepting-bids' : 'awaiting-opening';
  }
}

// The client's "Subscription & Payment Structure" (14 Nov 2026): suppliers pay US$79 a month, or a year at 15% off.
// ponytail: prices live here until online payments (Phase 3) read them from subscription_plans; that table
// still holds 805 for the year, so set it to 805.80 then.
const monthlyPriceUsd = 79;
const annualDiscountPercent = 15;
/** The yearly price: twelve months less the discount, to the cent (US$805.80). */
export const annualPriceUsd = Math.round(monthlyPriceUsd * 12 * (100 - annualDiscountPercent)) / 100;
/** The supplier prices as one sentence, for the trial messages. */
export const subscriptionPrices = `US$${monthlyPriceUsd} a month, or US$${annualPriceUsd.toFixed(2)} a year (save ${annualDiscountPercent}%)`;

/** Whether a supplier's trial or subscription currently allows bidding (same rule as private.supplier_has_access). */
export function supplierHasAccess(
  subscription: Pick<Tables<'subscriptions'>, 'status' | 'trial_ends_at' | 'current_period_end'> | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) {
    return false;
  }
  const isLater = (timestamp: string | null): boolean => timestamp !== null && new Date(timestamp).getTime() > now.getTime();
  if (subscription.status === 'trial') {
    return isLater(subscription.trial_ends_at);
  }
  if (subscription.status === 'active') {
    // An active subscription with no end date counts as active (Part B, decision 5).
    return subscription.current_period_end === null || isLater(subscription.current_period_end);
  }
  return false;
}

/**
 * Returns a path that is safe to send someone to after logging in, or null. Only same-site paths are
 * allowed, so a crafted ?next= link cannot bounce people to another website.
 */
export function safeNextPath(requestedPath: string | null): string | null {
  if (!requestedPath || !requestedPath.startsWith('/')) {
    return null;
  }
  // "//host" and "/\host" are treated by browsers as links to another site.
  if (requestedPath.startsWith('//') || requestedPath.startsWith('/\\')) {
    return null;
  }
  return requestedPath;
}
