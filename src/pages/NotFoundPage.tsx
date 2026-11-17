/**
 * Shown for any address the app does not know. The numbers are the picture: a giant 404 filled with the
 * warehouse aisle photograph, drifting slowly as if someone were searching the shelves. Below it, what
 * happened, the address that was asked for, and the two places most people were looking for.
 */
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.tsx';
import { supportEmail } from '../lib/supabase.ts';

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <section className="@container relative overflow-hidden rounded-3xl bg-midnight px-6 pt-10 pb-12 text-white shadow-[0_30px_80px_-30px_rgb(0_23_58/0.6)] sm:px-12 sm:pt-14 sm:pb-16">
      <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.2em] text-gold uppercase sm:text-sm">
        <span className="h-0.5 w-8 rounded-full bg-gold" aria-hidden="true" />
        Error 404 · Page not found
      </p>
      <h2
        aria-label="404"
        className="photo-letters -mx-1 mt-4 font-serif -mb-[0.12em] text-[53cqw] leading-[0.8] font-semibold tracking-[-0.05em] select-none motion-safe:animate-aisle-pan"
      >
        404
      </h2>
      <div className="mt-8 grid items-end gap-8 border-t border-white/15 pt-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="font-serif text-3xl leading-tight sm:text-4xl">We looked down every aisle.</p>
          <p className="mt-3 max-w-xl leading-relaxed text-white/70">
            That address does not exist. It may be an old link from the previous version of the site.
          </p>
          <p className="mt-4 w-fit max-w-full rounded-md bg-white/10 px-3 py-1.5 font-mono text-sm break-all text-white/80">caribbeantender.com{pathname}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="bg-white text-ink hover:bg-white/90">
            <Link to="/">Go to the homepage</Link>
          </Button>
          <Button asChild variant="gold">
            <Link to="/tenders">View current tenders</Link>
          </Button>
        </div>
      </div>
      <p className="mt-8 text-sm text-white/55">
        Followed a link that should work? Email <a href={`mailto:${supportEmail}`} className="font-medium text-white">{supportEmail}</a> and say where you found it.
      </p>
    </section>
  );
}
