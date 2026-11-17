/** The signed-in person's session and their business and supplier accounts, shared across the app. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';
import type { Tables } from '../lib/database.types.ts';

export type AccountType = 'business' | 'supplier';

type AccountState = {
  session: Session | null;
  isLoading: boolean;
  profile: Tables<'profiles'> | null;
  businessProfile: Tables<'business_profiles'> | null;
  supplierProfile: Tables<'supplier_profiles'> | null;
  /** The person's staff role, or null for everyone who isn't staff. Admin pages also need MFA (aal2). */
  staffRole: Tables<'staff_members'>['role'] | null;
  /** Why the accounts couldn't be loaded, or null. Pages must not read a failed load as "no account". */
  accountsError: Error | null;
  refreshAccounts: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AccountContext = createContext<AccountState | null>(null);

/** Loads a login's profile, its business and supplier accounts (either may be missing) and any staff role. */
export async function loadAccounts(userId: string) {
  const [profileResult, businessResult, supplierResult, staffResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('business_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('supplier_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('staff_members').select('role').eq('user_id', userId).maybeSingle(),
  ]);
  for (const result of [profileResult, businessResult, supplierResult, staffResult]) {
    if (result.error) throw result.error;
  }
  return {
    profile: profileResult.data,
    businessProfile: businessResult.data,
    supplierProfile: supplierResult.data,
    staffRole: staffResult.data?.role ?? null,
  };
}

/** Creates the signed-in person's business or supplier account, as the "Create ... Account" buttons do. */
export async function createAccount(accountType: AccountType, session: Session): Promise<void> {
  const table = accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  const { error } = await supabase.from(table).insert({ user_id: session.user.id, contact_email: session.user.email ?? null });
  if (error) throw error;
}

/** Provides the session and accounts to every page, and keeps them in step with Supabase Auth. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsSessionLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((authEvent, nextSession) => {
      setSession(nextSession);
      // However the session ended (Log out, another tab, an expired refresh), nothing cached for one
      // person may be shown to whoever signs in next.
      if (authEvent === 'SIGNED_OUT') queryClient.clear();
    });
    return () => listener.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id ?? null;
  const accountsQuery = useQuery({
    queryKey: ['accounts', userId],
    queryFn: () => loadAccounts(userId ?? ''),
    enabled: userId !== null,
  });

  const value: AccountState = {
    session,
    isLoading: isSessionLoading || (userId !== null && accountsQuery.isPending),
    profile: accountsQuery.data?.profile ?? null,
    businessProfile: accountsQuery.data?.businessProfile ?? null,
    supplierProfile: accountsQuery.data?.supplierProfile ?? null,
    staffRole: accountsQuery.data?.staffRole ?? null,
    accountsError: userId !== null && accountsQuery.isError ? accountsQuery.error : null,
    refreshAccounts: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts', userId] });
    },
    // This device only (Tevin, 2026-11-17); the person stays signed in on their other devices.
    signOut: async () => {
      await supabase.auth.signOut({ scope: 'local' });
    },
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** The current session and accounts. Must be used inside AccountProvider. */
export function useAccount(): AccountState {
  const accountState = useContext(AccountContext);
  if (!accountState) {
    throw new Error('useAccount was called outside AccountProvider; wrap the app in <AccountProvider>.');
  }
  return accountState;
}
