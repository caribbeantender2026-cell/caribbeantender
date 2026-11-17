/** Register a login with its first account type (business or supplier). */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccount } from '../../auth/AccountContext.tsx';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Choice, Field, Input, NativeSelect } from '../../components/ui/fields.tsx';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const minimumPasswordLength = 8;
const maximumNameLength = 120;

const registerSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your full name.').max(maximumNameLength, `Use at most ${maximumNameLength} characters.`),
    email: z.email('Enter a valid email address.'),
    confirmEmail: z.string(),
    password: z.string().min(minimumPasswordLength, `Use at least ${minimumPasswordLength} characters.`),
    confirmPassword: z.string(),
    accountType: z.enum(['business', 'supplier'], { message: 'Choose Business or Supplier.' }),
    acceptedTerms: z.literal(true, { message: 'Agree to the Terms of Service and Privacy Policy to create an account.' }),
  })
  .refine((values) => values.email.trim().toLowerCase() === values.confirmEmail.trim().toLowerCase(), {
    path: ['confirmEmail'],
    message: 'The email addresses do not match.',
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  });
type RegisterValues = z.infer<typeof registerSchema>;

/** The live "✓ match" hint the original form showed while typing. */
function MatchHint({ first, second, what }: { first: string; second: string; what: string }) {
  if (!first || !second) return null;
  return first === second
    ? <div className="text-sm font-medium text-success">✓ {what} match</div>
    : <div className="text-sm font-medium text-destructive">✗ {what} do not match</div>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { refreshAccounts } = useAccount();
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });
  const watched = form.watch();
  const { errors, isSubmitting } = form.formState;

  async function register(values: RegisterValues) {
    setOutcome(null);
    const { data, error } = await supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: {
        // The signup trigger records accepted_terms_at from this (PRD P1-01).
        data: { full_name: values.fullName, account_type: values.accountType, accepted_terms: true },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) {
      setOutcome({ tone: 'error', text: errorMessage(error) });
      return;
    }
    // Supabase returns a user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) {
      setOutcome({ tone: 'error', text: 'This email already has a CaribbeanTender login. Log in instead; you can add the other account type from your dashboard.' });
      return;
    }
    if (data.session) {
      // The signup trigger has already created the account from the registration details.
      await refreshAccounts();
      void navigate(values.accountType === 'business' ? '/business/profile' : '/supplier/profile');
      return;
    }
    form.reset();
    setOutcome({ tone: 'success', text: 'Registration successful. Check your email, confirm your address, then log in.' });
  }

  return (
    <Card className="w-[calc(100%-2rem)] max-w-md py-8">
      <CardHeader className="px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Register Account</h2>
        <p>
          Each email address creates one CaribbeanTender login. That login may have one Business account and one Supplier
          account. Select the first account type you want to create.
        </p>
      </CardHeader>
      <CardContent className="px-8">
        <form className="grid gap-4" onSubmit={form.handleSubmit(register)} noValidate>
          <Field label="Full Name" htmlFor="registerName" error={errors.fullName?.message}>
            <Input id="registerName" autoComplete="name" {...form.register('fullName')} />
          </Field>

          <Field label="Email Address" htmlFor="registerEmail" error={errors.email?.message}>
            <Input id="registerEmail" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label="Confirm Email Address" htmlFor="confirmEmail">
            <Input id="confirmEmail" type="email" autoComplete="email" {...form.register('confirmEmail')} />
            <MatchHint first={(watched.email ?? '').trim().toLowerCase()} second={(watched.confirmEmail ?? '').trim().toLowerCase()} what="Email addresses" />
          </Field>

          <Field label="Password" htmlFor="registerPassword" error={errors.password?.message}>
            <Input id="registerPassword" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm Password" htmlFor="confirmPassword">
            <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
            <MatchHint first={watched.password ?? ''} second={watched.confirmPassword ?? ''} what="Passwords" />
          </Field>

          <Field label="Account Type" htmlFor="registerType" error={errors.accountType?.message}>
            <NativeSelect id="registerType" defaultValue="" {...form.register('accountType')}>
              <option value="" disabled>Select account type</option>
              <option value="business">Business</option>
              <option value="supplier">Supplier</option>
            </NativeSelect>
          </Field>

          <div className="grid gap-2">
            <Choice id="acceptedTerms" type="checkbox" {...form.register('acceptedTerms')}>
              I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>
            </Choice>
            {errors.acceptedTerms && <p className="text-sm font-medium text-destructive">{errors.acceptedTerms.message}</p>}
          </div>

          {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create Account'}</Button>
            <Button asChild variant="gold"><Link to="/login">Already Registered?</Link></Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
