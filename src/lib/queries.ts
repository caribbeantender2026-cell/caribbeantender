/** Data reads and small helpers that several pages share. */
import { useQuery } from '@tanstack/react-query';
import type { AccountType } from '../auth/AccountContext.tsx';
import { supabase } from './supabase.ts';

/** Rows per page on the tender list (PRD P1-04: paginated). */
export const tendersPerPage = 20;

/** A category on offer: the client's name, code and procurement type (Works, Services, Goods & Supplies). */
export type Category = { id: number; name: string; code: string | null; procurement_type: string | null };

/** The active categories, in the order staff set. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id, name, code, procurement_type').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data satisfies Category[];
    },
  });
}

/** Open tenders still taking bids, soonest-closing first, one page at a time, optionally in one category. */
export function useOpenTenders(categoryId: number | null, page: number) {
  return useQuery({
    queryKey: ['open-tenders', categoryId, page],
    queryFn: async () => {
      let request = supabase
        .from('tenders')
        .select('id, business_id, title, closes_at, status, category_id', { count: 'exact' })
        .eq('status', 'open')
        .gt('closes_at', new Date().toISOString())
        .order('closes_at')
        // Tenders closing at the same moment keep one order, so none repeats or goes missing between pages.
        .order('id')
        .range(page * tendersPerPage, (page + 1) * tendersPerPage - 1);
      if (categoryId !== null) {
        request = request.eq('category_id', categoryId);
      }
      const { data, error, count } = await request;
      if (error) throw error;
      return { tenders: data, totalCount: count ?? 0 };
    },
  });
}

/** A company as other people see it: its name and picture. */
export type PublicCompany = { companyName: string | null; picturePath: string | null };

/**
 * Companies by user id, for one account type: tenders show the business account, bids the supplier
 * account, even for a person who has both. Every signed-in user may read these (OPEN_QUESTIONS.md, item 18).
 */
export function useCompanies(userIds: string[], accountType: AccountType) {
  const uniqueIds = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ['companies', accountType, uniqueIds],
    enabled: uniqueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_names')
        .select('user_id, company_name, picture_path')
        .eq('account_type', accountType)
        .in('user_id', uniqueIds);
      if (error) throw error;
      return new Map(data.map((row): [string, PublicCompany] => [row.user_id, { companyName: row.company_name, picturePath: row.picture_path }]));
    },
  });
}

/** The signed-in supplier's trial or subscription (only their own row is readable). */
export function useOwnSubscription(supplierId: string) {
  return useQuery({
    queryKey: ['subscription', supplierId],
    enabled: supplierId !== '',
    queryFn: async () => {
      const { data, error } = await supabase.from('subscriptions').select('status, trial_ends_at, current_period_end').eq('supplier_id', supplierId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Downloads a recorded document. The database checks and logs the request; the download-document
 * Edge Function then signs a link that works for 60 seconds (PRD 8.5).
 */
export async function downloadDocument(documentId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('download-document', { body: { document_id: documentId } });
  if (error) {
    // The function's own message ("Document not found.") is in the response body.
    const detail = error.context instanceof Response ? ((await error.context.json().catch(() => null)) as { error?: string } | null)?.error : null;
    throw new Error(detail ?? 'The download could not start. Check your connection and try again.');
  }
  if (!data?.url) throw new Error('The download could not start. Try again in a minute.');
  window.location.assign(data.url);
}

/** Formats an amount in its currency (Jamaican dollars unless the bid says otherwise). */
export function formatAmount(amount: number, currency = 'JMD'): string {
  return new Intl.NumberFormat('en-JM', { style: 'currency', currency }).format(amount);
}
