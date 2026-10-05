/** Request a password-reset email, without revealing whether the address is registered. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Notice } from '../../components/Notices.tsx';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const forgotPasswordSchema = z.object({ email: z.email('Enter the email address used for your login.') });
type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });
  const { errors, isSubmitting } = form.formState;

  async function sendResetLink(values: ForgotPasswordValues) {
    setOutcome(null);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setOutcome({ tone: 'error', text: errorMessage(error) });
      return;
    }
    form.reset();
    setOutcome({
      tone: 'success',
      text: 'If an account exists for that email address, a password-reset link has been sent. Check your inbox and spam folder.',
    });
  }

  return (
    <div className="card form recovery-card">
      <h2>Forgot Password</h2>
      <p>Enter the email address used for your CaribbeanTender login. If an account exists for it, a password-reset link will be sent.</p>
      <form onSubmit={form.handleSubmit(sendResetLink)} noValidate>
        <label htmlFor="recoveryEmail">Email Address</label>
        <input id="recoveryEmail" type="email" autoComplete="email" {...form.register('email')} />
        {errors.email && <div className="match-error">{errors.email.message}</div>}
        {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
        <div className="actions">
          <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Send Reset Link'}</button>
          <Link className="btn gold" to="/login">Back to Login</Link>
        </div>
      </form>
      <p className="small recovery-note">For security, CaribbeanTender will not confirm whether an email address is registered.</p>
    </div>
  );
}
