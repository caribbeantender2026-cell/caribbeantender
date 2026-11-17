/** The top of every signed-in page, so each starts the same way: where you are, what the page is for, and its main action. */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';

/** A page title in the home page's serif, a one-line explanation, an optional way back, and the page's main buttons. */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 no-underline hover:text-ink hover:no-underline">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h2 className="font-serif text-4xl leading-[1.1] font-normal tracking-[-0.01em] text-ink sm:text-5xl">{title}</h2>
        {description && <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink/70">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-end gap-3">{actions}</div>}
    </header>
  );
}
