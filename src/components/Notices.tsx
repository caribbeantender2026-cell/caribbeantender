/** Small status messages in the site's existing notice style. */
import type { ReactNode } from 'react';
import { errorMessage } from '../lib/supabase.ts';

/** A highlighted message; "error" and "success" change its colour. */
export function Notice({ tone, children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  return <div className={tone ? `notice ${tone}` : 'notice'} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

/** Shown while a page's data is loading. */
export function Loading() {
  return <p className="small">Loading…</p>;
}

/** Shows what went wrong with a request, in plain English. */
export function ErrorNotice({ error }: { error: unknown }) {
  return <Notice tone="error">{errorMessage(error)}</Notice>;
}
