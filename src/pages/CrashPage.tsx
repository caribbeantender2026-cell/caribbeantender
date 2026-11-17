/**
 * Shown in place of a page that crashed, or that couldn't load because a newer version of the site
 * replaced its code while the tab was open, so nobody is left on a blank or developer error screen.
 */
import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { Button } from '../components/ui/button.tsx';
import { supportEmail } from '../lib/supabase.ts';

// The browsers' wording when a page's code file is gone because a newer deploy replaced it.
const outdatedVersionPattern = /dynamically imported module|Importing a module script failed|Expected a JavaScript/i;

/** The crash screen: a plain explanation, Reload, and a way home. Reports the error to Sentry when it is set up. */
export function CrashPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  const isOutdatedVersion = outdatedVersionPattern.test(message);

  useEffect(() => {
    console.error('A page crashed:', error);
    // Sentry is only loaded when a DSN is set (see main.tsx); without one the console line is the record.
    if (import.meta.env.VITE_SENTRY_DSN) void import('@sentry/react').then((sentry) => sentry.captureException(error));
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 text-ink">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-4xl leading-tight">{isOutdatedVersion ? 'CaribbeanTender has been updated' : 'Something went wrong'}</h1>
        <p className="mt-3 leading-relaxed text-ink/70">
          {isOutdatedVersion
            ? 'Reload the page to get the new version. Anything you already saved is safe.'
            : `This page hit an error. Reload to try again. If it keeps happening, email ${supportEmail} and say what you were doing.`}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
          <Button asChild variant="outline"><a href="/">Go to the homepage</a></Button>
        </div>
      </div>
    </main>
  );
}
