/**
 * The one frame every page shares: a header with the links for who is signed in (Home and About for
 * visitors), an account menu, the page, and the footer. The header sits clear over the photograph on the
 * home, About and sign-in pages until the page scrolls, and is see-through paper after that.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowLeftRightIcon, Building2Icon, ChevronDownIcon, CompassIcon, LifeBuoyIcon, LogOutIcon, MenuIcon, PlusIcon, type LucideIcon } from 'lucide-react';
import { createAccount, useAccount, type AccountType } from '../auth/AccountContext.tsx';
import { classNames } from '../lib/classNames.ts';
import { configurationProblem, errorMessage, supportEmail } from '../lib/supabase.ts';
import logoFullLight from '../assets/brand/logo-full-light.webp';
import logoMarkLight from '../assets/brand/logo-mark-light.webp';
import logoMark from '../assets/brand/logo-mark.webp';
import { AccountPicture } from './AccountPicture.tsx';
import { Loading, Notice } from './Notices.tsx';

// Loaded only when the tour opens, so it adds nothing to every other page.
const Tour = lazy(async () => ({ default: (await import('./Tour.tsx')).Tour }));

type NavigationLink = { to: string; label: string; isActive: (pathname: string) => boolean };

const dashboardPath: Record<AccountType, string> = { business: '/business', supplier: '/supplier' };
const accountLabel: Record<AccountType, string> = { business: 'Business', supplier: 'Supplier' };
// What the other account type is for, shown under "Add a … account" in the menu.
const otherAccountPurpose: Record<AccountType, string> = { business: 'To post your own tenders', supplier: 'To bid on tenders' };

const exactly = (path: string) => (pathname: string) => pathname === path;
const startsWith = (path: string) => (pathname: string) => pathname.startsWith(path);
const openTendersLink: NavigationLink = { to: '/tenders', label: 'Open tenders', isActive: startsWith('/tenders') };
const formsLink: NavigationLink = { to: '/forms', label: 'Forms', isActive: startsWith('/forms') };
// The same links on every page: they depend only on who is signed in, never on the page.
const linksByAccountType: Record<AccountType, NavigationLink[]> = {
  business: [
    { to: '/business', label: 'My tenders', isActive: (pathname) => pathname === '/business' || pathname.startsWith('/business/tenders') },
    openTendersLink,
    formsLink,
  ],
  supplier: [openTendersLink, { to: '/supplier', label: 'My bids', isActive: exactly('/supplier') }, formsLink],
};
const visitorLinks: NavigationLink[] = [
  { to: '/', label: 'Home', isActive: exactly('/') },
  { to: '/about', label: 'About us', isActive: exactly('/about') },
];
const adminLink: NavigationLink = { to: '/admin', label: 'Admin', isActive: exactly('/admin') };

const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8';
const headerButton = 'cursor-pointer rounded-button px-2.5 py-[9px] min-[400px]:px-3 text-sm leading-5 font-medium whitespace-nowrap no-underline transition-colors duration-150 hover:no-underline sm:px-4 md:py-[7px]';
const menuItem = 'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink no-underline transition-colors hover:bg-ink/5 hover:no-underline';
const menuGapPixels = 8;

// Pages that open with the photograph behind the header.
const photoTopPaths = new Set(['/', '/about']);
// Pages that are a form card over the photograph, which then runs behind the header.
const formPhotoPaths = new Set(['/login', '/register', '/forgot-password', '/reset-password']);
// Pages laid out by the page itself, edge to edge; every other page sits in the app's reading column.
const fullWidthPaths = new Set(['/', '/about', '/privacy', '/terms', ...formPhotoPaths]);

const rememberedAccountTypeKey = 'caribbeantender.account-type';

/** The account type the person last worked in, if the browser kept it. */
function rememberedAccountType(): AccountType | null {
  try {
    const value = localStorage.getItem(rememberedAccountTypeKey);
    return value === 'business' || value === 'supplier' ? value : null;
  } catch {
    // Private windows can refuse storage; the frame then uses the account the person has.
    return null;
  }
}

/**
 * Which of the person's accounts the frame shows: the page's own type on business and supplier pages,
 * else the one they last worked in, else the one they have. Null for visitors and accounts with neither.
 */
function useActiveAccountType(pageAccountType: AccountType | undefined): AccountType | null {
  const { businessProfile, supplierProfile } = useAccount();
  useEffect(() => {
    if (!pageAccountType) return;
    try {
      localStorage.setItem(rememberedAccountTypeKey, pageAccountType);
    } catch {
      // Not remembering only means shared pages fall back to the account the person has.
    }
  }, [pageAccountType]);
  const hasAccount = (accountType: AccountType) => (accountType === 'business' ? businessProfile : supplierProfile) !== null;
  const candidates = [pageAccountType, rememberedAccountType(), 'business', 'supplier'] as const;
  return candidates.find((candidate): candidate is AccountType => candidate !== undefined && candidate !== null && hasAccount(candidate)) ?? null;
}

/** The client's CT monogram and the name, as one link home. On dark backgrounds the navy in the mark turns white. */
function Wordmark({ tone }: { tone: 'ink' | 'white' }) {
  return (
    <Link to="/" className={classNames('flex shrink-0 items-center gap-2.5 no-underline hover:no-underline', tone === 'ink' ? 'text-ink' : 'text-white')}>
      <img src={tone === 'ink' ? logoMark : logoMarkLight} alt="" width={240} height={134} className="h-7 w-auto shrink-0 min-[400px]:h-8 sm:h-9" />
      <span className="font-serif text-[19px] leading-none tracking-[-0.01em] max-[374px]:sr-only min-[400px]:text-[22px] sm:text-[26px]" translate="no">Caribbean Tender</span>
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

/** One row of the account menu: an icon, a label and an optional line under it. */
function MenuRow({ icon: Icon, label, detail }: { icon: LucideIcon; label: string; detail?: string }) {
  return (
    <>
      <Icon className="size-4 shrink-0 text-ink/60" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {detail && <span className="block text-xs text-ink/60">{detail}</span>}
      </span>
    </>
  );
}

/**
 * The person's menu, opened from their name in the header: which account they are in, its company
 * profile, the tour, their other account type, help and log out. On phones it also holds the page links.
 * A native popover, so clicking outside or pressing Escape closes it.
 */
function AccountMenu({ accountType, links, isOverPhoto, onTakeTour }: { accountType: AccountType | null; links: NavigationLink[]; isOverPhoto: boolean; onTakeTour: () => void }) {
  const { session, businessProfile, supplierProfile, refreshAccounts, signOut } = useAccount();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const profile = accountType === 'business' ? businessProfile : accountType === 'supplier' ? supplierProfile : null;
  const companyName = profile?.company_name || session?.user.email || 'Your account';
  const otherType: AccountType | null = accountType === 'business' ? 'supplier' : accountType === 'supplier' ? 'business' : null;
  const hasOtherAccount = otherType === 'business' ? businessProfile !== null : otherType === 'supplier' ? supplierProfile !== null : false;
  const closeMenu = () => menuRef.current?.hidePopover();

  async function addOtherAccount() {
    if (!session || !otherType) return;
    setIsCreating(true);
    setProblem(null);
    try {
      await createAccount(otherType, session);
      await refreshAccounts();
      closeMenu();
      void navigate(`${dashboardPath[otherType]}/profile`);
    } catch (error) {
      setProblem(`Unable to add the ${accountLabel[otherType].toLowerCase()} account: ${errorMessage(error)}`);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        popoverTarget={menuId}
        aria-label={`Account menu for ${companyName}`}
        // ponytail: placed when opened; resizing the window while it is open leaves it where it was until reopened.
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setPosition({ top: box.bottom + menuGapPixels, right: window.innerWidth - box.right });
        }}
        className={classNames(
          'flex cursor-pointer items-center gap-2 rounded-button border p-1 pr-2.5 text-sm font-medium transition-colors duration-200',
          isOverPhoto ? 'border-white/25 bg-white/10 text-white backdrop-blur-md hover:bg-white/15' : 'border-ink/35 bg-white/40 text-ink hover:bg-white/70',
        )}
      >
        <AccountPicture picturePath={profile?.picture_path} className={isOverPhoto ? 'bg-white text-ink' : undefined} />
        <span className="hidden max-w-44 truncate lg:block">{companyName}</span>
        <ChevronDownIcon className="hidden size-4 md:block" aria-hidden="true" />
        <MenuIcon className="size-4 md:hidden" aria-hidden="true" />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        className="fixed inset-auto m-0 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-1.5 text-ink shadow-[0_16px_40px_-12px_rgb(0_23_58/0.35)]"
        style={{ top: position.top, right: position.right }}
      >
        <div className="grid gap-0.5">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <AccountPicture picturePath={profile?.picture_path} className="size-9" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{companyName}</span>
              <span className="block text-xs text-ink/60">{accountType ? `${accountLabel[accountType]} account` : session?.user.email}</span>
            </span>
          </div>
          {/* On phones the header has no room for the page links, so they live here. */}
          <div className="grid gap-0.5 border-t pt-1.5 md:hidden">
            {links.map((link) => (
              <Link key={link.to} to={link.to} onClick={closeMenu} aria-current={link.isActive(pathname) ? 'page' : undefined} className={classNames(menuItem, 'font-medium', link.isActive(pathname) && 'bg-ink/5')}>
                {link.label}
              </Link>
            ))}
            {accountType === 'business' && (
              <Link to="/business/tenders/new" onClick={closeMenu} className={classNames(menuItem, 'font-medium')}>
                <MenuRow icon={PlusIcon} label="Post a tender" />
              </Link>
            )}
          </div>
          {accountType && (
            <div className="grid gap-0.5 border-t pt-1.5">
              <Link to={`${dashboardPath[accountType]}/profile`} onClick={closeMenu} className={menuItem}>
                <MenuRow icon={Building2Icon} label="Company profile" />
              </Link>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  closeMenu();
                  onTakeTour();
                }}
              >
                <MenuRow icon={CompassIcon} label="Take the tour" />
              </button>
              {otherType &&
                (hasOtherAccount ? (
                  <Link to={dashboardPath[otherType]} onClick={closeMenu} className={menuItem}>
                    <MenuRow icon={ArrowLeftRightIcon} label={`Switch to your ${accountLabel[otherType].toLowerCase()} account`} />
                  </Link>
                ) : (
                  <button type="button" className={menuItem} disabled={isCreating} onClick={() => void addOtherAccount()}>
                    <MenuRow icon={PlusIcon} label={isCreating ? 'Please wait…' : `Add a ${accountLabel[otherType].toLowerCase()} account`} detail={otherAccountPurpose[otherType]} />
                  </button>
                ))}
            </div>
          )}
          <div className="grid gap-0.5 border-t pt-1.5">
            <a href={`mailto:${supportEmail}`} className={menuItem}>
              <MenuRow icon={LifeBuoyIcon} label="Help" detail={supportEmail} />
            </a>
            <button
              type="button"
              className={menuItem}
              onClick={async () => {
                closeMenu();
                await signOut();
                void navigate('/');
              }}
            >
              <MenuRow icon={LogOutIcon} label="Log out" />
            </button>
          </div>
          {problem && <p className="px-3 py-2 text-sm text-destructive">{problem}</p>}
        </div>
      </div>
    </>
  );
}

/** The frame itself. Business and supplier pages pass their account type, which also opens the tour on a first visit. */
function SiteFrame({ pageAccountType, children }: { pageAccountType?: AccountType; children: ReactNode }) {
  const { session, profile: personProfile, staffRole, refreshAccounts } = useAccount();
  const { pathname } = useLocation();
  const [topMarker, isAtTop] = useIsAtTop();
  const accountType = useActiveAccountType(pageAccountType);
  const [isTourRequested, setIsTourRequested] = useState(false);
  const hasFormPhoto = formPhotoPaths.has(pathname);
  const isOverPhoto = (photoTopPaths.has(pathname) || hasFormPhoto) && isAtTop;
  const isFullWidth = fullWidthPaths.has(pathname);

  const signedInLinks = accountType ? linksByAccountType[accountType] : [openTendersLink, formsLink];
  const links = session ? [...signedInLinks, ...(staffRole ? [adminLink] : [])] : visitorLinks;
  // The tour opens by itself on a person's first visit to their business or supplier pages, and from the menu after that.
  const completedTours = personProfile?.onboarding_completed;
  const hasSeenTour = (type: AccountType) => typeof completedTours === 'object' && completedTours !== null && !Array.isArray(completedTours) && type in completedTours;
  const isFirstVisit = accountType !== null && pageAccountType === accountType && personProfile !== null && !hasSeenTour(accountType);
  const isTourOpen = accountType !== null && (isTourRequested || isFirstVisit);

  const linkTone = (isActive: boolean) =>
    isOverPhoto
      ? classNames(isActive ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white')
      : classNames(isActive ? 'bg-ink/[0.07] text-ink' : 'text-ink/70 hover:bg-ink/5 hover:text-ink');
  // Sign in and Sign up sit joined in one see-through group, like the home page demo's tabs.
  const buttonGroup = isOverPhoto ? 'border-white/25 bg-white/10 backdrop-blur-md' : 'border-ink/35 bg-white/40';
  const outlineButton = classNames(headerButton, isOverPhoto ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-ink/10');
  const solidButton = classNames(headerButton, isOverPhoto ? 'bg-white text-ink hover:bg-white/90' : 'bg-ink text-white hover:bg-ink/85');

  return (
    <div className="relative flex min-h-dvh flex-col bg-paper text-ink">
      <div ref={topMarker} className="pointer-events-none absolute top-0 left-0 h-10 w-px" aria-hidden="true" />
      <SkipLink />
      <header className={classNames('sticky top-0 z-30 transition-colors duration-200', !isOverPhoto && 'bg-paper/60 shadow-[0_1px_0_rgb(0_32_79/0.08)] backdrop-blur-xl backdrop-saturate-150')}>
        <div className={classNames(container, 'flex h-16 items-center gap-3 min-[400px]:gap-4 sm:h-[72px] lg:gap-10')}>
          <h1 className="contents">
            <Wordmark tone={isOverPhoto ? 'white' : 'ink'} />
          </h1>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1 text-sm font-medium">
              {links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    aria-current={link.isActive(pathname) ? 'page' : undefined}
                    className={classNames('block rounded-button px-3 py-2 no-underline transition-colors duration-150 hover:no-underline', linkTone(link.isActive(pathname)))}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {session ? (
              <>
                {accountType === 'business' && (
                  <Link to="/business/tenders/new" className={classNames(solidButton, 'hidden items-center gap-1.5 sm:inline-flex')}>
                    <PlusIcon className="size-4" aria-hidden="true" />
                    Post a tender
                  </Link>
                )}
                <AccountMenu accountType={accountType} links={links} isOverPhoto={isOverPhoto} onTakeTour={() => setIsTourRequested(true)} />
              </>
            ) : (
              <div className={classNames('flex items-center gap-1 rounded-button border p-1 transition-colors duration-200', buttonGroup)}>
                <Link to="/login" className={outlineButton}>Sign in</Link>
                <Link to="/register" className={solidButton}>Sign up</Link>
              </div>
            )}
          </div>
        </div>
      </header>
      <main
        id="main"
        className={classNames(
          'flex-1',
          // App pages share the header's column, so titles line up under the logo; full-width pages lay themselves out.
          !isFullWidth && classNames(container, 'pt-10 pb-20 sm:pt-14'),
          // The photograph fills the first screen, from behind the header down; the footer follows below it.
          hasFormPhoto && 'hills-backdrop -mt-16 grid min-h-dvh place-items-center pt-24 pb-12 sm:-mt-[72px] sm:pt-28 sm:pb-16',
        )}
      >
        {configurationProblem && <Notice tone="error">{configurationProblem}</Notice>}
        {session && personProfile && !personProfile.is_active && (
          <Notice tone="error">This account has been deactivated, so you can look but not post, bid or upload. Contact {supportEmail} for help.</Notice>
        )}
        {children}
      </main>
      <footer className="bg-midnight text-white">
        <div className={classNames(container, 'grid gap-10 pt-16 pb-12 md:grid-cols-[1fr_auto_auto_auto] md:gap-24')}>
          <Link to="/" className="self-start" aria-label="Caribbean Tender home">
            <img src={logoFullLight} alt="Caribbean Tender, Private Procurement Platform" width={720} height={421} className="h-auto w-56" />
          </Link>
          <nav aria-label="Platform" className="grid content-start gap-3 text-sm font-medium">
            <p className="font-normal text-white/50">Platform</p>
            <Link to="/about" className="text-white no-underline hover:text-white/70 hover:no-underline">About us</Link>
            {session ? (
              <>
                <Link to="/tenders" className="text-white no-underline hover:text-white/70 hover:no-underline">Open tenders</Link>
                <Link to="/forms" className="text-white no-underline hover:text-white/70 hover:no-underline">Forms</Link>
              </>
            ) : (
              <>
                <Link to="/register" className="text-white no-underline hover:text-white/70 hover:no-underline">Create an account</Link>
                <Link to="/login" className="text-white no-underline hover:text-white/70 hover:no-underline">Sign in</Link>
              </>
            )}
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
        <p className={classNames(container, 'border-t border-white/15 py-6 text-sm text-white/50')}>
          Copyright © {new Date().getFullYear()} CaribbeanTender. Every deadline is in Jamaica time.
        </p>
      </footer>
      {isTourOpen && accountType && (
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
    </div>
  );
}

/** Layout for pages anyone can see (some need a sign-in), with the frame for whoever is looking. */
export function PublicLayout() {
  return (
    <SiteFrame>
      <Outlet />
    </SiteFrame>
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
    return (
      <Notice>
        This login does not have a {accountLabel[accountType].toLowerCase()} account yet. Add one from the menu under your name, top right.
      </Notice>
    );
  }
  return <>{children}</>;
}

/** Layout for business or supplier pages: requires a signed-in account of that type. */
export function AccountLayout({ accountType }: { accountType: AccountType }) {
  return (
    <SiteFrame pageAccountType={accountType}>
      <RequireAccount accountType={accountType}>
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
