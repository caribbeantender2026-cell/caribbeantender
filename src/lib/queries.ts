/** Data reads and small helpers that several pages share. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.ts';

/** Rows per page on the tender list (PRD P1-04: paginated). */
export const tendersPerPage = 20;

/** The active categories, in the order staff set. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id, name').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data;
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

/** Company names by user id. Every signed-in user may read every company name (OPEN_QUESTIONS.md, item 18). */
export function useCompanyNames(userIds: string[]) {
  const uniqueIds = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ['company-names', uniqueIds],
    enabled: uniqueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_names').select('user_id, account_type, company_name').in('user_id', uniqueIds);
      if (error) throw error;
      // A person can have both account types; the business name is the one shown on tenders.
      const names = new Map<string, string>();
      for (const row of data) {
        if (row.company_name && (row.account_type === 'business' || !names.has(row.user_id))) {
          names.set(row.user_id, row.company_name);
        }
      }
      return names;
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
