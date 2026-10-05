/** The site frame (top bar, brand, navigation, footer) and the layouts for public, business and supplier pages. */
import { useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { createAccount, useAccount, type AccountType } from '../auth/AccountContext.tsx';
import { configurationProblem, errorMessage } from '../lib/supabase.ts';
import { jamaicaTimeZone } from '../lib/time.ts';
import { Loading, Notice } from './Notices.tsx';

type NavigationLink = { to: string; label: string };

const dashboardPath: Record<AccountType, string> = { business: '/business', supplier: '/supplier' };
const accountLabel: Record<AccountType, string> = { business: 'Business', supplier: 'Supplier' };

const businessLinks: NavigationLink[] = [
  { to: '/', label: 'Homepage' },
  { to: '/tenders', label: 'Current Tenders' },
  { to: '/business', label: 'Business Dashboard' },
  { to: '/business/profile', label: 'Company Profile' },
  { to: '/business/tenders/new', label: 'Create Tender' },
];
const supplierLinks: NavigationLink[] = [
  { to: '/', label: 'Homepage' },
  { to: '/tenders', label: 'Current Tenders' },
  { to: '/supplier', label: 'Supplier Dashboard' },
  { to: '/supplier/profile', label: 'Supplier Profile' },
  { to: '/subscription', label: 'Subscription' },
];

function todayInJamaica(): string {
  return new Intl.DateTimeFormat('en-JM', { timeZone: jamaicaTimeZone, dateStyle: 'full' }).format(new Date());
}

/** The page chrome every screen shares, in the original site's markup and classes. */
function SiteFrame({ links, brandAside, children }: { links: NavigationLink[]; brandAside: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <span>Caribbean Tender Procurement Marketplace</span>
          <span>Assistance: support@example.com</span>
        </div>
      </div>
      <header className="brandbar">
        <div className="wrap">
          <div className="logo">
            <div className="seal">CT</div>
            <div className="brand">
              <h1>CaribbeanTender</h1>
              <p>Electronic Tendering for Private Sector Businesses and Suppliers</p>
            </div>
          </div>
          <div>{brandAside}</div>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        <div className="wrap">
          <ul>
            {links.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <span className="datebox">{todayInJamaica()}</span>
        </div>
      </nav>
      <main className="wrap">
        {configurationProblem && <Notice tone="error">{configurationProblem}</Notice>}
        {children}
      </main>
      <footer className="footer">
        <div className="wrap">© {new Date().getFullYear()} CaribbeanTender. Electronic tendering for private-sector businesses and suppliers.</div>
      </footer>
    </>
  );
}

/** Layout for pages anyone can see. Signed-in people get links to their dashboards instead of Register and Log in. */
export function PublicLayout() {
  const { session, businessProfile, supplierProfile, signOut } = useAccount();
  const navigate = useNavigate();
  const links: NavigationLink[] = [{ to: '/', label: 'Homepage' }, { to: '/tenders', label: 'Current Tenders' }];
  if (businessProfile) links.push({ to: '/business', label: 'Business Dashboard' });
  if (supplierProfile) links.push({ to: '/supplier', label: 'Supplier Dashboard' });
  if (!session) links.push({ to: '/register', label: 'Register' }, { to: '/login', label: 'Login' });

  const brandAside = session ? (
    <button
      className="btn logout-btn"
      type="button"
      onClick={async () => {
        await signOut();
        void navigate('/');
      }}
    >
      Logout
    </button>
  ) : (
    <>
      <Link className="btn gold" to="/register">Register</Link>{" "}
      <Link className="btn" to="/login">Log in</Link>
    </>
  );

  return (
    <SiteFrame links={links} brandAside={brandAside}>
      <Outlet />
    </SiteFrame>
  );
}

/** "Signed in as" header with the account switcher and logout, as on the original dashboards. */
function ProfileHeader({ accountType }: { accountType: AccountType }) {
  const { session, businessProfile, supplierProfile, refreshAccounts, signOut } = useAccount();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const profile = accountType === 'business' ? businessProfile : supplierProfile;
  const otherType: AccountType = accountType === 'business' ? 'supplier' : 'business';
  const hasOtherAccount = otherType === 'business' ? businessProfile !== null : supplierProfile !== null;

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
      <div className="profile-header">
        <div>
          <p className="welcome-text">Signed in as</p>
          <h2>{profile?.company_name || `${accountLabel[accountType]} Name`}</h2>
          <span className={`account-badge ${accountType}-badge`}>{accountLabel[accountType]} Account</span>
        </div>
        <div className="profile-actions">
          <Link to={dashboardPath[accountType]} className="btn">Dashboard</Link>
          {hasOtherAccount ? (
            <Link to={dashboardPath[otherType]} className="btn outline">Switch to {accountLabel[otherType]}</Link>
          ) : (
            <button type="button" className="btn outline" disabled={isCreating} onClick={() => void createOtherAccount()}>
              {isCreating ? 'Please wait…' : `Create ${accountLabel[otherType]} Account`}
            </button>
          )}
          <button
            className="btn logout-btn"
            type="button"
            onClick={async () => {
              await signOut();
              void navigate('/login');
            }}
          >
            Logout
          </button>
        </div>
      </div>
      {problem && <Notice tone="error">{problem}</Notice>}
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
  const badge = <span className={`account-badge ${accountType}-badge`}>{accountLabel[accountType]}</span>;
  return (
    <SiteFrame links={accountType === 'business' ? businessLinks : supplierLinks} brandAside={badge}>
      <RequireAccount accountType={accountType}>
        <ProfileHeader accountType={accountType} />
        <Outlet />
      </RequireAccount>
    </SiteFrame>
  );
}
