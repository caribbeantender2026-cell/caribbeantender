/** Data reads and small helpers that several pages share. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.ts';

const signedUrlLifetimeSeconds = 60;

/** Tenders that are open and still before their deadline, soonest-closing first. */
export function useOpenTenders(limit?: number) {
  return useQuery({
    queryKey: ['open-tenders', limit],
    queryFn: async () => {
      let request = supabase
        .from('tenders')
        .select('id, business_id, title, closes_at, status')
        .eq('status', 'open')
        .gt('closes_at', new Date().toISOString())
        .order('closes_at');
      if (limit) {
        request = request.limit(limit);
      }
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Company names for a set of businesses or suppliers. The database only returns names the viewer
 * may see (for suppliers: only once their bids are open to the viewer), so missing names are expected.
 */
export function useCompanyNames(view: 'business_names_public' | 'supplier_names_public', userIds: string[]) {
  const uniqueIds = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ['company-names', view, uniqueIds],
    enabled: uniqueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from(view).select('user_id, company_name').in('user_id', uniqueIds);
      if (error) throw error;
      return new Map(data.map((row) => [row.user_id ?? '', row.company_name ?? '']));
    },
  });
}

/** The signed-in supplier's trial or subscription (only their own row is readable). */
export function useOwnSubscription(supplierId: string) {
  return useQuery({
    queryKey: ['subscription', supplierId],
    enabled: supplierId !== '',
    queryFn: async () => {
      const { data, error } = await supabase.from('subscriptions').select('*').eq('supplier_id', supplierId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Starts a download of a stored file through a short-lived signed link. */
export async function downloadStoredFile(bucket: 'tender-documents' | 'bid-documents', path: string, fileName: string): Promise<void> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, signedUrlLifetimeSeconds, { download: fileName });
  if (error) throw error;
  window.location.assign(data.signedUrl);
}

/** Formats an amount in Jamaican dollars, as the original site did. */
export function formatJamaicanDollars(amount: number): string {
  return new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD' }).format(amount);
}
