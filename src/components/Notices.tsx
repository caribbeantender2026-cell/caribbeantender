/** Status messages (shadcn/ui alerts) and the loading line shared by every page. */
import type { ReactNode } from 'react';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, LoaderCircleIcon } from 'lucide-react';
import { errorMessage } from '../lib/supabase.ts';
import { Alert, AlertDescription } from './ui/alert.tsx';

/** A highlighted message; "error" and "success" change its colour and icon. */
export function Notice({ tone, children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlertIcon : tone === 'success' ? CircleCheckIcon : InfoIcon;
  return (
    <Alert variant={tone === 'error' ? 'destructive' : (tone ?? 'default')} role={tone === 'error' ? 'alert' : 'status'} className="my-4">
      <Icon aria-hidden="true" />
      {/* One wrapper, so text and links flow as a sentence instead of each becoming a row of the description's grid. */}
      <AlertDescription>
        <div className="leading-relaxed">{children}</div>
      </AlertDescription>
    </Alert>
  );
}

/** Shown while a page's data is loading. */
export function Loading() {
  return (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
      Loading…
    </p>
  );
}

/** Shows what went wrong with a request, in plain English. */
export function ErrorNotice({ error }: { error: unknown }) {
  return <Notice tone="error">{errorMessage(error)}</Notice>;
}
