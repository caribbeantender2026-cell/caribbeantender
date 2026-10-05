/** Log in, then go to the right dashboard (or where the person was heading). */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createAccount, loadAccounts, useAccount, type AccountType } from '../../auth/AccountContext.tsx';
import { Notice } from '../../components/Notices.tsx';
import { safeNextPath } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const loginSchema = z.object({
  email: z.email('Enter the email address you registered with.'),
  password: z.string().min(1, 'Enter your password.'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParameters] = useSearchParams();
  const { refreshAccounts } = useAccount();
  const [problem, setProblem] = useState<string | null>(null);
  const [needsChoice, setNeedsChoice] = useState(false);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const nextPath = safeNextPath(searchParameters.get('next'));

  async function logIn(values: LoginValues) {
    setProblem(null);
    const { data, error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setProblem(errorMessage(error));
      return;
    }
    try {
      let accounts = await loadAccounts(data.user.id);
      // Accounts registered before email confirmation finished may still lack their profile row.
      const registeredType = String(data.user.user_metadata.account_type ?? '').toLowerCase();
      if (!accounts.businessProfile && !accounts.supplierProfile && (registeredType === 'business' || registeredType === 'supplier')) {
        await createAccount(registeredType as AccountType, data.session);
        accounts = await loadAccounts(data.user.id);
      }
      await refreshAccounts();
      if (!accounts.businessProfile && !accounts.supplierProfile) {
        setProblem('You are logged in, but this email has no Business or Supplier account. Register one to continue.');
        return;
      }
      if (nextPath) {
        void navigate(nextPath);
      } else if (accounts.businessProfile && accounts.supplierProfile) {
        setNeedsChoice(true);
      } else {
        void navigate(accounts.businessProfile ? '/business' : '/supplier');
      }
    } catch (accountsError) {
      setProblem(`You are logged in, but your accounts could not be loaded: ${errorMessage(accountsError)}`);
    }
  }

  if (needsChoice) {
    return (
      <div className="card form">
        <h2>Choose Account</h2>
        <p>This email has both a Business account and a Supplier account. Choose which one you want to use.</p>
        <div className="actions">
          <Link className="btn" to="/business">Business Account</Link>
          <Link className="btn gold" to="/supplier">Supplier Account</Link>
        </div>
      </div>
    );
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <div className="card form">
      <h2>Log in</h2>
      <p className="small">Log in with the email address and password used when you registered.</p>
      {searchParameters.get('reset') === 'success' && <Notice tone="success">Your password was updated. Log in with the new password.</Notice>}
      <form onSubmit={form.handleSubmit(logIn)} noValidate>
        <label htmlFor="loginEmail">Email Address</label>
        <input id="loginEmail" type="email" autoComplete="email" {...form.register('email')} />
        {errors.email && <div className="match-error">{errors.email.message}</div>}
        <label htmlFor="loginPassword">Password</label>
        <input id="loginPassword" type="password" autoComplete="current-password" {...form.register('password')} />
        {errors.password && <div className="match-error">{errors.password.message}</div>}
        <div className="password-help"><Link to="/forgot-password">Forgot your password?</Link></div>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div className="actions">
          <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Log in'}</button>
          <Link className="btn gold" to="/register">Register</Link>
        </div>
      </form>
    </div>
  );
}
