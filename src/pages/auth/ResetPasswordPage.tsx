/** Set a new password from the link in the reset email. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Notice } from '../../components/Notices.tsx';
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
    <div className="card form recovery-card">
      <h2>Reset Password</h2>
      <p>Enter your new password below. Both password fields must match.</p>
      {linkState === 'verifying' && <Notice>Verifying your password-reset link…</Notice>}
      {linkState === 'invalid' && (
        <Notice tone="error">
          This password-reset link is invalid or has expired. <Link to="/forgot-password">Request a new reset link</Link>.
        </Notice>
      )}
      {linkState === 'ready' && (
        <form onSubmit={form.handleSubmit(updatePassword)} noValidate>
          <label htmlFor="newPassword">New Password</label>
          <input id="newPassword" type="password" autoComplete="new-password" {...form.register('password')} />
          {errors.password && <div className="match-error">{errors.password.message}</div>}
          <label htmlFor="confirmNewPassword">Confirm New Password</label>
          <input id="confirmNewPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
          {errors.confirmPassword && <div className="match-error">{errors.confirmPassword.message}</div>}
          <div className="password-rules small">Use at least {minimumPasswordLength} characters. A longer passphrase is recommended.</div>
          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="actions">
            <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Updating…' : 'Update Password'}</button>
            <Link className="btn gold" to="/login">Back to Login</Link>
          </div>
        </form>
      )}
    </div>
  );
}
