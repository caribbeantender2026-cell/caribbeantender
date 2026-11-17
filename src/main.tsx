/** Entry point: data cache, accounts, and every route in the app. */
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProvider } from './auth/AccountContext.tsx';
import { AccountLayout, PublicLayout, RequireSignIn } from './components/Frame.tsx';
import { CrashPage } from './pages/CrashPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
// Self-hosted fonts (the CSP allows fonts only from this site): a serif for headlines, a sans for text.
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/instrument-sans';
import './styles/app.css';

const cacheLifetimeMilliseconds = 30_000;

// One address for the site: sign-ins are kept per address, and every email links to the bare domain.
// ponytail: done here because Cloudflare Pages' _redirects can't redirect between domains; a Cloudflare
// redirect rule would skip loading the page first.
const bareDomain = 'caribbeantender.com';
if (window.location.hostname === `www.${bareDomain}`) {
  window.location.replace(`https://${bareDomain}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

// Emails already sent by the old site link to its .html pages; the reset link's token must survive.
const legacyPaths: Record<string, string> = {
  '/index.html': '/',
  '/login.html': '/login',
  '/reset-password.html': '/reset-password',
};

/** Sends old .html addresses to their new pages, keeping the query and the #token fragment. */
function LegacyRedirect() {
  const location = useLocation();
  const target = legacyPaths[location.pathname];
  if (!target) return <NotFoundPage />;
  return <Navigate to={{ pathname: target, search: location.search, hash: location.hash }} replace />;
}

// Every page but the homepage loads on first visit, so the homepage downloads only what it needs (PRD P1-16).
const page = (load: () => Promise<ComponentType>) => ({ lazy: async () => ({ Component: await load() }) });

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <CrashPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/about', ...page(async () => (await import('./pages/InformationPage.tsx')).AboutPage) },
      { path: '/privacy', ...page(async () => (await import('./pages/InformationPage.tsx')).PrivacyPage) },
      { path: '/terms', ...page(async () => (await import('./pages/InformationPage.tsx')).TermsPage) },
      { path: '/login', ...page(async () => (await import('./pages/auth/LoginPage.tsx')).LoginPage) },
      { path: '/register', ...page(async () => (await import('./pages/auth/RegisterPage.tsx')).RegisterPage) },
      { path: '/forgot-password', ...page(async () => (await import('./pages/auth/ForgotPasswordPage.tsx')).ForgotPasswordPage) },
      { path: '/reset-password', ...page(async () => (await import('./pages/auth/ResetPasswordPage.tsx')).ResetPasswordPage) },
      {
        // Browsing tenders needs an account (PRD P1-04).
        element: <RequireSignIn><Outlet /></RequireSignIn>,
        children: [
          { path: '/tenders', ...page(async () => (await import('./pages/TendersPage.tsx')).TendersPage) },
          { path: '/tenders/:tenderId', ...page(async () => (await import('./pages/TenderDetailsPage.tsx')).TenderDetailsPage) },
          { path: '/admin', ...page(async () => (await import('./pages/admin/AdminPage.tsx')).AdminPage) },
          { path: '/forms', ...page(async () => (await import('./pages/FormsPage.tsx')).FormsPage) },
          { path: '/forms/:formKey', ...page(async () => (await import('./pages/FormsPage.tsx')).FormFillPage) },
        ],
      },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
  {
    element: <AccountLayout accountType="business" />,
    errorElement: <CrashPage />,
    children: [
      { path: '/business', ...page(async () => (await import('./pages/business/BusinessDashboardPage.tsx')).BusinessDashboardPage) },
      { path: '/business/profile', ...page(async () => (await import('./pages/account/CompanyProfilePage.tsx')).BusinessProfilePage) },
      { path: '/business/tenders/new', ...page(async () => (await import('./pages/business/TenderFormPage.tsx')).TenderFormPage) },
      { path: '/business/tenders/:tenderId', ...page(async () => (await import('./pages/business/TenderManagePage.tsx')).TenderManagePage) },
      { path: '/business/tenders/:tenderId/edit', ...page(async () => (await import('./pages/business/TenderFormPage.tsx')).TenderFormPage) },
    ],
  },
  {
    element: <AccountLayout accountType="supplier" />,
    errorElement: <CrashPage />,
    children: [
      { path: '/supplier', ...page(async () => (await import('./pages/supplier/SupplierDashboardPage.tsx')).SupplierDashboardPage) },
      { path: '/supplier/profile', ...page(async () => (await import('./pages/account/CompanyProfilePage.tsx')).SupplierProfilePage) },
      { path: '/tenders/:tenderId/bid', ...page(async () => (await import('./pages/supplier/SubmitBidPage.tsx')).SubmitBidPage) },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: cacheLifetimeMilliseconds, retry: 1 } },
});

// Error reporting (PRD 9.1; OPEN_QUESTIONS.md, item 15): off until VITE_SENTRY_DSN is set, and then
// loaded after the app, so it never slows the first page. No personal data is sent.
const sentryDsn: string = import.meta.env.VITE_SENTRY_DSN ?? '';
if (sentryDsn) {
  void import('@sentry/react').then((sentry) => sentry.init({ dsn: sentryDsn, sendDefaultPii: false, environment: import.meta.env.MODE }));
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('index.html is missing <div id="root">; the app has nowhere to render.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <RouterProvider router={router} />
      </AccountProvider>
    </QueryClientProvider>
  </StrictMode>,
);
