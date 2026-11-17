/** Set a new password from the link in the reset email. */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, PasswordInput } from '../../components/ui/fields.tsx';
import { recoverySession, resetRecoveredPassword, errorMessage, supabase } from '../../lib/supabase.ts';

const minimumPasswordLength = 8;

const resetSchema = z
  .object({
    password: z.string().min(minimumPasswordLength, `Use at least ${minimumPasswordLength} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, { path: ['confirmPassword'], message: 'The passwords do not match.' });
type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const linkParameters = new URLSearchParams(hash.slice(1));
  const linkFailed = linkParameters.has('error') || linkParameters.has('error_code');
  const [verifiedState, setLinkState] = useState<'verifying' | 'ready' | 'invalid'>('verifying');
  const linkState = linkFailed ? 'invalid' : verifiedState;
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (linkFailed) {
      recoverySession.clear();
      setLinkState('invalid');
      return;
    }
    let initialCheck: number | undefined;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      window.clearTimeout(initialCheck);
      if (event === 'INITIAL_SESSION' && !recoverySession.matches(session)) {
        // Auth queues PASSWORD_RECOVERY on the next task after reading a valid link.
        initialCheck = window.setTimeout(() => setLinkState(recoverySession.matches(session) ? 'ready' : 'invalid'), 0);
        return;
      }
      setLinkState(recoverySession.matches(session) ? 'ready' : 'invalid');
    });
    return () => {
      window.clearTimeout(initialCheck);
      listener.subscription.unsubscribe();
    };
  }, [linkFailed]);

  async function updatePassword(values: ResetValues) {
    setProblem(null);
    try {
      await resetRecoveredPassword(values.password);
      void navigate('/login?reset=success');
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }

  return (
    <Card className="w-[calc(100%-2rem)] max-w-md py-8">
      <CardHeader className="px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Reset Password</h2>
        <p>Enter your new password below. Both password fields must match.</p>
      </CardHeader>
      <CardContent className="px-8">
        {problem && <Notice tone="error">{problem}</Notice>}
        {linkState === 'verifying' && <Notice>Verifying your password-reset link…</Notice>}
        {linkState === 'invalid' && (
          <Notice tone="error">
            This password-reset link is invalid or has expired. <Link to="/forgot-password">Request a new reset link</Link>.
          </Notice>
        )}
        {linkState === 'ready' && (
          <form className="grid gap-4" onSubmit={form.handleSubmit(updatePassword)} noValidate>
            <Field label="New Password" htmlFor="newPassword" error={errors.password?.message}>
              <PasswordInput id="newPassword" autoComplete="new-password" {...form.register('password')} />
            </Field>
            <Field label="Confirm New Password" htmlFor="confirmNewPassword" error={errors.confirmPassword?.message}>
              <PasswordInput id="confirmNewPassword" autoComplete="new-password" {...form.register('confirmPassword')} />
            </Field>
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">Use at least {minimumPasswordLength} characters. A longer passphrase is recommended.</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Updating…' : 'Update Password'}</Button>
              <Button asChild variant="gold"><Link to="/login">Back to Login</Link></Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
