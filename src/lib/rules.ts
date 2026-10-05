/**
 * The app's view of the database rules, used only to decide what to show. The database enforces
 * every rule itself; these mirror them so the screen matches what the database will allow.
 */
import type { Enums, Tables } from './database.types.ts';

/** Where a tender stands for bidding and for its sealed bids. */
export type TenderPhase = 'draft' | 'accepting-bids' | 'awaiting-opening' | 'opened' | 'awarded' | 'cancelled';

/** A short label and badge style for each phase. */
export const tenderPhaseDisplay: Record<TenderPhase, { label: string; badgeStyle: string }> = {
  draft: { label: 'Draft', badgeStyle: 'draft' },
  'accepting-bids': { label: 'Open', badgeStyle: 'open' },
  'awaiting-opening': { label: 'Deadline passed', badgeStyle: 'waiting' },
  opened: { label: 'Closed, bids opened', badgeStyle: 'closed' },
  awarded: { label: 'Awarded', badgeStyle: 'awarded' },
  cancelled: { label: 'Cancelled', badgeStyle: 'cancelled' },
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

/** Whether a supplier's trial or subscription currently allows bidding (same rule as private.supplier_has_access). */
export function supplierHasAccess(
  subscription: Pick<Tables<'subscriptions'>, 'status' | 'trial_ends_at' | 'current_period_ends_at'> | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) {
    return false;
  }
  const isLater = (timestamp: string | null): boolean => timestamp !== null && new Date(timestamp).getTime() > now.getTime();
  if (subscription.status === 'trialing') {
    return isLater(subscription.trial_ends_at);
  }
  if (subscription.status === 'active') {
    return isLater(subscription.current_period_ends_at);
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
