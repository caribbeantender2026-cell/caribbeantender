/** Entry point: data cache, accounts, and every route in the app. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProvider } from './auth/AccountContext.tsx';
import { AccountLayout, PublicLayout } from './components/Frame.tsx';
import { CompanyProfilePage } from './pages/account/CompanyProfilePage.tsx';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage.tsx';
import { LoginPage } from './pages/auth/LoginPage.tsx';
import { RegisterPage } from './pages/auth/RegisterPage.tsx';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage.tsx';
import { BusinessDashboardPage } from './pages/business/BusinessDashboardPage.tsx';
import { TenderBidsPage } from './pages/business/TenderBidsPage.tsx';
import { TenderFormPage } from './pages/business/TenderFormPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SubmitBidPage } from './pages/supplier/SubmitBidPage.tsx';
import { SubscriptionPage } from './pages/supplier/SubscriptionPage.tsx';
import { SupplierDashboardPage } from './pages/supplier/SupplierDashboardPage.tsx';
import { TenderDetailsPage } from './pages/TenderDetailsPage.tsx';
import { TendersPage } from './pages/TendersPage.tsx';
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

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/tenders', element: <TendersPage /> },
      { path: '/tenders/:tenderId', element: <TenderDetailsPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
  {
    element: <AccountLayout accountType="business" />,
    children: [
      { path: '/business', element: <BusinessDashboardPage /> },
      { path: '/business/profile', element: <CompanyProfilePage accountType="business" /> },
      { path: '/business/tenders/new', element: <TenderFormPage /> },
      { path: '/business/tenders/:tenderId/edit', element: <TenderFormPage /> },
      { path: '/business/tenders/:tenderId/bids', element: <TenderBidsPage /> },
    ],
  },
  {
    element: <AccountLayout accountType="supplier" />,
    children: [
      { path: '/supplier', element: <SupplierDashboardPage /> },
      { path: '/supplier/profile', element: <CompanyProfilePage accountType="supplier" /> },
      { path: '/tenders/:tenderId/bid', element: <SubmitBidPage /> },
      { path: '/subscription', element: <SubscriptionPage /> },
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
