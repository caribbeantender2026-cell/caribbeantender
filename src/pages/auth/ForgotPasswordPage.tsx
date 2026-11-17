/** Request a password-reset email, without revealing whether the address is registered. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Notice } from '../../components/Notices.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input } from '../../components/ui/fields.tsx';
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
    <Card className="w-[calc(100%-2rem)] max-w-md py-8">
      <CardHeader className="px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-navy-dark">Forgot Password</h2>
        <p>Enter the email address used for your CaribbeanTender login. If an account exists for it, a password-reset link will be sent.</p>
      </CardHeader>
      <CardContent className="px-8">
        <form className="grid gap-4" onSubmit={form.handleSubmit(sendResetLink)} noValidate>
          <Field label="Email Address" htmlFor="recoveryEmail" error={errors.email?.message}>
            <Input id="recoveryEmail" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Send Reset Link'}</Button>
            <Button asChild variant="gold"><Link to="/login">Back to Login</Link></Button>
          </div>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">For security, CaribbeanTender will not confirm whether an email address is registered.</p>
      </CardContent>
    </Card>
  );
}
