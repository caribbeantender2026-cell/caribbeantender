/**
 * The site frame (top bar, brand bar, navigation, footer) and the layouts for public, business and
 * supplier pages. Same structure and colours as the original site, built with shadcn/ui components.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowLeftRightIcon, Building2Icon, CompassIcon, LayoutDashboardIcon, LogOutIcon, PlusIcon } from 'lucide-react';
import { createAccount, useAccount, type AccountType } from '../auth/AccountContext.tsx';
import { classNames } from '../lib/classNames.ts';
import { configurationProblem, errorMessage, supportEmail } from '../lib/supabase.ts';
import { jamaicaTimeZone } from '../lib/time.ts';
import logoFullLight from '../assets/brand/logo-full-light.webp';
import logoMarkLight from '../assets/brand/logo-mark-light.webp';
import logoMark from '../assets/brand/logo-mark.webp';
import { Loading, Notice } from './Notices.tsx';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';

// Loaded only when the tour opens, so it adds nothing to every other page.
const Tour = lazy(async () => ({ default: (await import('./Tour.tsx')).Tour }));

type NavigationLink = { to: string; label: string };

const dashboardPath: Record<AccountType, string> = { business: '/business', supplier: '/supplier' };
const accountLabel: Record<AccountType, string> = { business: 'Business', supplier: 'Supplier' };

const businessLinks: NavigationLink[] = [
  { to: '/tenders', label: 'Open tenders' },
  { to: '/business', label: 'My tenders' },
  { to: '/business/tenders/new', label: 'Post a tender' },
  { to: '/forms', label: 'Forms' },
  { to: '/business/profile', label: 'Company profile' },
];
const supplierLinks: NavigationLink[] = [
  { to: '/tenders', label: 'Open tenders' },
  { to: '/supplier', label: 'My bids' },
  { to: '/forms', label: 'Forms' },
  { to: '/supplier/profile', label: 'Supplier profile' },
];

function todayInJamaica(): string {
  return new Intl.DateTimeFormat('en-JM', { timeZone: jamaicaTimeZone, dateStyle: 'full' }).format(new Date());
}

/** Up to two initials from a company name, for the account avatar. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /^[A-Za-z0-9]/.test(word));
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'CT';
}

/** The client's CT monogram and the name, as one link home. On dark backgrounds the navy in the mark turns white. */
function Wordmark({ tone }: { tone: 'ink' | 'white' }) {
  return (
    <Link to="/" className={classNames('flex items-center gap-2.5 no-underline hover:no-underline', tone === 'ink' ? 'text-ink' : 'text-white')}>
      <img src={tone === 'ink' ? logoMark : logoMarkLight} alt="" width={240} height={134} className="h-8 w-auto shrink-0 sm:h-9" />
      <span className="font-serif text-[22px] leading-none tracking-[-0.01em] sm:text-[26px]" translate="no">Caribbean Tender</span>
    </Link>
  );
}

/** Lets keyboard users jump past the header; visible only when focused. */
function SkipLink() {
  return (
    <a href="#main" className="sr-only rounded-md bg-card px-4 py-2 text-sm font-medium text-ink shadow-surface focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
      Skip to content
    </a>
  );
}

const marketingContainer = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8';
const headerButton = 'cursor-pointer rounded-[4px] border px-2.5 py-[11px] text-sm leading-5 font-medium whitespace-nowrap no-underline transition-colors duration-150 hover:no-underline sm:px-3 md:py-[7px]';

// Pages that open with the photograph behind the header.
const photoTopPaths = new Set(['/', '/about']);
// Pages that are a form card over the photograph, which then runs behind the header.
const formPhotoPaths = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

/** A marker for the top of the page, and whether it is still in view. Lets the header sit clear over a photograph until the page scrolls. */
function useIsAtTop(): [RefObject<HTMLDivElement | null>, boolean] {
  const topMarker = useRef<HTMLDivElement>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  useEffect(() => {
    if (!topMarker.current) return;
    const observer = new IntersectionObserver(([entry]) => setIsAtTop(entry?.isIntersecting ?? true));
    observer.observe(topMarker.current);
    return () => observer.disconnect();
  }, []);
  return [topMarker, isAtTop];
}

/**
 * The visitor's frame, after harvey.ai: one header bar, full-width content, a dark footer. On the homepage
 * and the sign-in pages the header sits clear over the photograph until the page scrolls.
 */
function MarketingFrame({ children }: { children: ReactNode }) {
  const { session, signOut } = useAccount();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [topMarker, isAtTop] = useIsAtTop();
  const hasFormPhoto = formPhotoPaths.has(pathname);
  const isOverPhoto = (photoTopPaths.has(pathname) || hasFormPhoto) && isAtTop;
  const linkTone = isOverPhoto ? 'text-white hover:text-white/75' : 'text-ink hover:text-ink/70';
  const outlineButton = classNames(headerButton, isOverPhoto ? 'border-white text-white hover:bg-white/10' : 'border-ink text-ink hover:bg-ink/5');
  const solidButton = classNames(headerButton, isOverPhoto ? 'border-white bg-white text-ink hover:bg-white/90' : 'border-ink bg-ink text-white hover:bg-ink/85');

  return (
    <div className="relative flex min-h-dvh flex-col bg-paper text-ink">
      <div ref={topMarker} className="pointer-events-none absolute top-0 left-0 h-10 w-px" aria-hidden="true" />
      <SkipLink />
      {configurationProblem && (
        <div className={marketingContainer}>
          <Notice tone="error">{configurationProblem}</Notice>
        </div>
      )}
      <header className={classNames('sticky top-0 z-30 transition-colors duration-200', !isOverPhoto && 'bg-paper/90 backdrop-blur-md')}>
        <div className={classNames(marketingContainer, 'flex h-16 items-center gap-4 sm:h-[72px] sm:gap-10')}>
          <h1 className="contents">
            <Wordmark tone={isOverPhoto ? 'white' : 'ink'} />
          </h1>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex gap-8 text-sm font-medium">
              <li><NavLink to="/" end className={classNames(linkTone, 'no-underline hover:no-underline')}>Home</NavLink></li>
              <li><NavLink to="/about" end className={classNames(linkTone, 'no-underline hover:no-underline')}>About us</NavLink></li>
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {session ? (
              <>
                <button
                  type="button"
                  className={outlineButton}
                  onClick={async () => {
                    await signOut();
                    void navigate('/');
                  }}
                >
                  Logout
                </button>
                <Link to="/tenders" className={solidButton}>Open tenders</Link>
              </>
            ) : (
              <>
                <Link to="/login" className={outlineButton}>Sign in</Link>
                <Link to="/register" className={solidButton}>Sign up</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main
        id="main"
        className={classNames(
          'marketing-main flex-1',
          // The photograph fills the first screen, from behind the header down; the footer follows below it.
          hasFormPhoto && 'hills-backdrop -mt-16 grid min-h-dvh place-items-center pt-24 pb-12 sm:-mt-[72px] sm:pt-28 sm:pb-16',
        )}
      >
        {children}
      </main>
      <footer className="bg-midnight text-white">
        <div className={classNames(marketingContainer, 'grid gap-10 pt-16 pb-12 md:grid-cols-[1fr_auto_auto_auto] md:gap-24')}>
          <Link to="/" className="self-start" aria-label="Caribbean Tender home">
            <img src={logoFullLight} alt="Caribbean Tender, Private Procurement Platform" width={720} height={421} className="h-auto w-56" />
          </Link>
          <nav aria-label="Platform" className="grid content-start gap-3 text-sm font-medium">
            <p className="font-normal text-white/50">Platform</p>
            <Link to="/about" className="text-white no-underline hover:text-white/70 hover:no-underline">About us</Link>
            <Link to="/register" className="text-white no-underline hover:text-white/70 hover:no-underline">Create an account</Link>
            <Link to="/login" className="text-white no-underline hover:text-white/70 hover:no-underline">Sign in</Link>
          </nav>
          <nav aria-label="Legal" className="grid content-start gap-3 text-sm font-medium">
            <p className="font-normal text-white/50">Legal</p>
            <Link to="/privacy" className="text-white no-underline hover:text-white/70 hover:no-underline">Privacy Policy</Link>
            <Link to="/terms" className="text-white no-underline hover:text-white/70 hover:no-underline">Terms of Service</Link>
          </nav>
          <div className="grid content-start gap-3 text-sm font-medium">
            <p className="font-normal text-white/50">Assistance</p>
            <span>{supportEmail}</span>
          </div>
        </div>
        <p className={classNames(marketingContainer, 'border-t border-white/15 py-6 text-sm text-white/50')}>
          Copyright © {new Date().getFullYear()} CaribbeanTender. Every deadline is in Jamaica time.
        </p>
      </footer>
    </div>
  );
}

/** The page chrome every screen shares: top bar, brand bar with the logo, navy navigation and footer. Visitors get the marketing frame. */
function SiteFrame({ links, brandAside, children }: { links: NavigationLink[]; brandAside: ReactNode; children: ReactNode }) {
  const { session, profile, staffRole } = useAccount();
  const { pathname } = useLocation();
  // The homepage is the same for everyone, so it always gets the visitor's frame.
  if (!session || pathname === '/') return <MarketingFrame>{children}</MarketingFrame>;
  const allLinks = staffRole ? [...links, { to: '/admin', label: 'Admin' }] : links;
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <div className="bg-navy-dark text-xs text-white/80">
        <div className="wrap flex h-8 items-center justify-between gap-4">
          <span>Caribbean Tender Procurement Marketplace</span>
          <span className="hidden sm:inline">Assistance: {supportEmail}</span>
        </div>
      </div>
      <header className="border-b-[3px] border-gold bg-card">
        <div className="wrap flex h-[72px] items-center justify-between gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-3 no-underline hover:no-underline">
            <img src={logoMark} alt="" width={240} height={134} className="h-10 w-auto shrink-0" />
            <span className="min-w-0 leading-tight">
              <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl" translate="no">Caribbean Tender</h1>
              <span className="hidden text-sm text-muted-foreground md:block">Electronic Tendering for Private Sector Businesses and Suppliers</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">{brandAside}</div>
        </div>
      </header>
      <nav className="bg-primary" aria-label="Main">
        <div className="wrap flex items-center justify-between gap-4">
          <ul className="-mx-2 flex gap-1 overflow-x-auto py-2">
            {allLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end
                  className={({ isActive }) =>
                    classNames(
                      'block rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white/85 no-underline transition-colors hover:bg-white/10 hover:text-white hover:no-underline',
                      isActive && 'bg-gold text-navy-dark hover:bg-gold hover:text-navy-dark',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <span className="hidden text-xs whitespace-nowrap text-white/70 lg:block">{todayInJamaica()}</span>
        </div>
      </nav>
      <main id="main" className="wrap flex-1 py-8">
        {configurationProblem && <Notice tone="error">{configurationProblem}</Notice>}
        {profile && !profile.is_active && (
          <Notice tone="error">This account has been deactivated, so you can look but not post, bid or upload. Contact {supportEmail} for help.</Notice>
        )}
        {children}
      </main>
      <footer className="bg-navy-dark text-sm text-white/75">
        <div className="wrap flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} CaribbeanTender</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Footer">
            <Link to="/about" className="text-white/85 hover:text-white">About us</Link>
            <Link to="/privacy" className="text-white/85 hover:text-white">Privacy Policy</Link>
            <Link to="/terms" className="text-white/85 hover:text-white">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Layout for pages anyone can see. Signed-in people get links to their dashboards; visitors get Sign in and Sign up. */
export function PublicLayout() {
  const { session, businessProfile, supplierProfile, signOut } = useAccount();
  const navigate = useNavigate();
  const links: NavigationLink[] = [{ to: '/', label: 'Home' }, { to: '/about', label: 'About us' }];
  if (session) links.push({ to: '/tenders', label: 'Open tenders' });
  if (businessProfile) links.push({ to: '/business', label: 'My tenders' });
  if (supplierProfile) links.push({ to: '/supplier', label: 'My bids' });

  const brandAside = session ? (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={async () => {
        await signOut();
        void navigate('/');
      }}
    >
      <LogOutIcon aria-hidden="true" />
      Logout
    </Button>
  ) : (
    <>
      <Button asChild variant="outline" size="sm">
        <Link to="/login">Sign in</Link>
      </Button>
      <Button asChild variant="gold" size="sm">
        <Link to="/register">Sign up</Link>
      </Button>
    </>
  );

  return (
    <SiteFrame links={links} brandAside={brandAside}>
      <Outlet />
    </SiteFrame>
  );
}

/** "Signed in as" card with the account switcher, the tour and logout, at the top of every dashboard page. */
function ProfileHeader({ accountType }: { accountType: AccountType }) {
  const { session, profile: personProfile, businessProfile, supplierProfile, refreshAccounts, signOut } = useAccount();
  // The tour opens by itself on a person's first visit as this account type, and from the button after that.
  const [isTourRequested, setIsTourRequested] = useState(false);
  const completedTours = personProfile?.onboarding_completed;
  const hasSeenTour = typeof completedTours === 'object' && completedTours !== null && !Array.isArray(completedTours) && accountType in completedTours;
  const isTourOpen = isTourRequested || (personProfile !== null && !hasSeenTour);
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const profile = accountType === 'business' ? businessProfile : supplierProfile;
  const otherType: AccountType = accountType === 'business' ? 'supplier' : 'business';
  const hasOtherAccount = otherType === 'business' ? businessProfile !== null : supplierProfile !== null;
  const companyName = profile?.company_name || `${accountLabel[accountType]} Name`;

  async function createOtherAccount() {
    if (!session) return;
    setIsCreating(true);
    setProblem(null);
    try {
      await createAccount(otherType, session);
      await refreshAccounts();
      void navigate(`${dashboardPath[otherType]}/profile`);
    } catch (error) {
      setProblem(`Unable to create the ${accountLabel[otherType]} account: ${errorMessage(error)}`);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <Card className="mb-8 gap-0 py-0">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground" aria-hidden="true">
              {initials(companyName)}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <h2 className="truncate text-lg font-semibold text-navy-dark">{companyName}</h2>
            </div>
            <Badge variant="secondary" className="hidden sm:inline-flex">{accountLabel[accountType]} Account</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={dashboardPath[accountType]}>
                <LayoutDashboardIcon aria-hidden="true" />
                Dashboard
              </Link>
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={() => setIsTourRequested(true)}>
              <CompassIcon aria-hidden="true" />
              Take the tour
            </Button>
            {hasOtherAccount ? (
              <Button asChild variant="outline" size="sm">
                <Link to={dashboardPath[otherType]}>
                  <ArrowLeftRightIcon aria-hidden="true" />
                  Switch to {accountLabel[otherType]}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" type="button" disabled={isCreating} onClick={() => void createOtherAccount()}>
                <PlusIcon aria-hidden="true" />
                {isCreating ? 'Please wait…' : `Create ${accountLabel[otherType]} Account`}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={async () => {
                await signOut();
                void navigate('/login');
              }}
            >
              <LogOutIcon aria-hidden="true" />
              Logout
            </Button>
          </div>
        </div>
      </Card>
      {problem && <Notice tone="error">{problem}</Notice>}
      {isTourOpen && (
        <Suspense fallback={null}>
          <Tour
            accountType={accountType}
            onClose={() => {
              setIsTourRequested(false);
              void refreshAccounts();
            }}
          />
        </Suspense>
      )}
    </>
  );
}

/**
 * Lets a page through only for someone signed in with the given account type. Everyone else is sent
 * to log in, or told how to get that account. This is for the screen only: the database decides
 * what each account may actually read and change.
 */
function RequireAccount({ accountType, children }: { accountType: AccountType; children: ReactNode }) {
  const { session, isLoading, businessProfile, supplierProfile } = useAccount();
  const location = useLocation();
  if (isLoading) {
    return <Loading />;
  }
  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  const profile = accountType === 'business' ? businessProfile : supplierProfile;
  if (!profile) {
    const otherType: AccountType = accountType === 'business' ? 'supplier' : 'business';
    const hasOther = otherType === 'business' ? businessProfile !== null : supplierProfile !== null;
    return (
      <Notice>
        This login does not have a {accountLabel[accountType]} account yet.{' '}
        {hasOther && <Link to={dashboardPath[otherType]}>Go to your {accountLabel[otherType]} dashboard</Link>}
        {hasOther && ' to create one from there.'}
      </Notice>
    );
  }
  return <>{children}</>;
}

/** Layout for business or supplier pages: requires a signed-in account of that type. */
export function AccountLayout({ accountType }: { accountType: AccountType }) {
  const badge = (
    <Badge variant="secondary" className="h-8 px-3 text-sm">
      <Building2Icon aria-hidden="true" />
      {accountLabel[accountType]}
    </Badge>
  );
  return (
    <SiteFrame links={accountType === 'business' ? businessLinks : supplierLinks} brandAside={badge}>
      <RequireAccount accountType={accountType}>
        <ProfileHeader accountType={accountType} />
        <Outlet />
      </RequireAccount>
    </SiteFrame>
  );
}

/** Sends visitors who aren't signed in to the sign-in page, then back (PRD P1-04: browsing needs an account). */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAccount();
  const location = useLocation();
  if (isLoading) {
    return <Loading />;
  }
  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}
