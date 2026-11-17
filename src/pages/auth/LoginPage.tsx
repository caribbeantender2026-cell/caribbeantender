/** Log in, then go to the right dashboard (or where the person was heading). */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createAccount, loadAccounts, useAccount, type AccountType } from '../../auth/AccountContext.tsx';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input } from '../../components/ui/fields.tsx';
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
        <form className="grid gap-4" onSubmit={form.handleSubmit(logIn)} noValidate>
          <Field label="Email Address" htmlFor="loginEmail" error={errors.email?.message}>
            <Input id="loginEmail" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label="Password" htmlFor="loginPassword" error={errors.password?.message}>
            <Input id="loginPassword" type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <div className="text-right text-sm"><Link to="/forgot-password">Forgot your password?</Link></div>
          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Log in'}</Button>
            <Button asChild variant="gold"><Link to="/register">Register</Link></Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
