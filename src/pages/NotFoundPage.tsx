/**
 * Shown for any address the app does not know: what happened, the address that was asked for, and the two
 * places most people were looking for. The warehouse aisle is the illustration: shelves searched, nothing there.
 */
import { Link, useLocation } from 'react-router';
import warehousePhoto from '../assets/photos/goods-warehouse.webp';
import { Button } from '../components/ui/button.tsx';
import { supportEmail } from '../lib/supabase.ts';

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <section className="grid items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
      <div>
        <p className="flex items-center gap-3 text-sm font-semibold tracking-[0.16em] text-ink/70 uppercase">
          <span className="h-0.5 w-8 rounded-full bg-gold" aria-hidden="true" />
          Error 404
        </p>
        <h2 className="mt-5 font-serif text-5xl leading-[1.05] tracking-[-0.01em] text-ink sm:text-6xl">We can't find that page</h2>
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink/70">
          That address does not exist. It may be an old link from the previous version of the site.
        </p>
        <p className="mt-5 w-fit max-w-full rounded-md bg-ink/5 px-3 py-1.5 font-mono text-sm break-all text-ink/80">caribbeantender.com{pathname}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/">Go to the homepage</Link>
          </Button>
          <Button asChild variant="gold">
            <Link to="/tenders">View current tenders</Link>
          </Button>
        </div>
        <p className="mt-8 text-sm text-ink/60">
          Followed a link that should work? Email <a href={`mailto:${supportEmail}`} className="font-medium text-ink">{supportEmail}</a> and say where you found it.
        </p>
      </div>
      <figure className="relative overflow-hidden rounded-2xl shadow-[0_24px_60px_-28px_rgb(0_23_58/0.55)]">
        <img src={warehousePhoto} alt="" width={1000} height={700} className="aspect-[4/3] w-full object-cover" />
        <figcaption className="absolute bottom-4 left-4 rounded-button border border-white/30 bg-white/15 px-3.5 py-2 text-sm font-medium text-white backdrop-blur-md">
          Aisle 404 · nothing on this shelf
        </figcaption>
      </figure>
    </section>
  );
}
