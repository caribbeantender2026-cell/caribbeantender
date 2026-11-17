/** Log in, then go to the right dashboard (or where the person was heading). */
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { createAccount, loadAccounts, type AccountType } from '../../auth/AccountContext.tsx';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, PasswordInput } from '../../components/ui/fields.tsx';
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
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [needsChoice, setNeedsChoice] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const nextPath = safeNextPath(searchParameters.get('next'));
  // A confirmation link that failed (expired, or used already) lands here with error_code in the hash.
  const emailLinkFailed = new URLSearchParams(useLocation().hash.slice(1)).has('error_code');

  async function logIn(values: LoginValues) {
    setProblem(null);
    setUnconfirmedEmail(null);
    setResendState('idle');
    const { data, error } = await supabase.auth.signInWithPassword(values);
    if (error?.code === 'email_not_confirmed') {
      setUnconfirmedEmail(values.email);
      setProblem('Confirm your email address first, using the link we emailed you when you registered.');
      return;
    }
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
      // Cached under the new user's id: the provider's refresh function still belongs to the signed-out visitor.
      queryClient.setQueryData(['accounts', data.user.id], accounts);
      if (nextPath) {
        // Staff without a business or supplier account still reach /admin this way.
        void navigate(nextPath);
      } else if (!accounts.businessProfile && !accounts.supplierProfile) {
        setProblem('You are logged in, but this email has no Business or Supplier account yet. Add one from the menu under your name, top right.');
      } else if (accounts.businessProfile && accounts.supplierProfile) {
        setNeedsChoice(true);
      } else {
        void navigate(accounts.businessProfile ? '/business' : '/supplier');
      }
    } catch (accountsError) {
      setProblem(`You are logged in, but your accounts could not be loaded: ${errorMessage(accountsError)}`);
    }
  }

  async function resendConfirmation(email: string) {
    setResendState('sending');
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/login` } });
    if (error) {
      setResendState('idle');
      setProblem(errorMessage(error));
      return;
    }
    setResendState('sent');
    setProblem(null);
  }

  if (needsChoice) {
    return (
      <Card className="w-[calc(100%-2rem)] max-w-md py-8">
        <CardHeader className="px-8">
          <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Choose Account</h2>
          <p>This email has both a Business account and a Supplier account. Choose which one you want to use.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 px-8">
          <Button asChild><Link to="/business">Business Account</Link></Button>
          <Button asChild variant="gold"><Link to="/supplier">Supplier Account</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <Card className="w-[calc(100%-2rem)] max-w-md py-8">
      <CardHeader className="px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Log in</h2>
        <CardDescription>Log in with the email address and password used when you registered.</CardDescription>
      </CardHeader>
      <CardContent className="px-8">
        {searchParameters.get('reset') === 'success' && <Notice tone="success">Your password was updated. Log in with the new password.</Notice>}
        {emailLinkFailed && (
          <Notice tone="error">That email link has expired or was already used. If you have confirmed your email already, just log in. If not, log in below to get a new link.</Notice>
        )}
        <form className="grid gap-4" onSubmit={form.handleSubmit(logIn)} noValidate>
          <Field label="Email Address" htmlFor="loginEmail" error={errors.email?.message}>
            <Input id="loginEmail" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label="Password" htmlFor="loginPassword" error={errors.password?.message}>
            <PasswordInput id="loginPassword" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <div className="text-right text-sm"><Link to="/forgot-password">Forgot your password?</Link></div>
          {problem && <Notice tone="error">{problem}</Notice>}
          {unconfirmedEmail && resendState === 'sent' && <Notice tone="success">A new confirmation link is on its way to {unconfirmedEmail}.</Notice>}
          {unconfirmedEmail && resendState !== 'sent' && (
            <div>
              <Button type="button" variant="outline" disabled={resendState === 'sending'} onClick={() => void resendConfirmation(unconfirmedEmail)}>
                {resendState === 'sending' ? 'Sending…' : 'Send a new confirmation link'}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Log in'}</Button>
            <Button asChild variant="gold"><Link to="/register">Register</Link></Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
