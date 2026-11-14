/** Entry point: data cache, accounts, and every route in the app. */
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProvider } from './auth/AccountContext.tsx';
import { AccountLayout, PublicLayout, RequireSignIn } from './components/Frame.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import './styles/app.css';

const cacheLifetimeMilliseconds = 30_000;

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
        ],
      },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
  {
    element: <AccountLayout accountType="business" />,
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
