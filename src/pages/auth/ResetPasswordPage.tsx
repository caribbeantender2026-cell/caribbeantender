/** Set a new password from the link in the reset email. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, PasswordInput } from '../../components/ui/fields.tsx';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const minimumPasswordLength = 8;
// Supabase reads the recovery token from the link asynchronously; give it a moment before giving up.
const recoveryCheckDelayMilliseconds = 1200;

const resetSchema = z
  .object({
    password: z.string().min(minimumPasswordLength, `Use at least ${minimumPasswordLength} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, { path: ['confirmPassword'], message: 'The passwords do not match.' });
type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [linkState, setLinkState] = useState<'verifying' | 'ready' | 'invalid'>('verifying');
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((authEvent, session) => {
      if (authEvent === 'PASSWORD_RECOVERY' && session) setLinkState('ready');
    });
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setLinkState((current) => (current === 'ready' || data.session ? 'ready' : 'invalid'));
    }, recoveryCheckDelayMilliseconds);
    return () => {
      listener.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  async function updatePassword(values: ResetValues) {
    setProblem(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setProblem(errorMessage(error));
      return;
    }
    await supabase.auth.signOut();
    void navigate('/login?reset=success');
  }

  return (
    <Card className="w-[calc(100%-2rem)] max-w-md py-8">
      <CardHeader className="px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Reset Password</h2>
        <p>Enter your new password below. Both password fields must match.</p>
      </CardHeader>
      <CardContent className="px-8">
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
            {problem && <Notice tone="error">{problem}</Notice>}
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
