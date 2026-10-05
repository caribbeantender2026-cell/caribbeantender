/** Supplier subscription plans. Payment is enabled in Stage 2; until then the buttons say so. */
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { supabase } from '../../lib/supabase.ts';

export function SubscriptionPage() {
  const [searchParameters] = useSearchParams();
  const plansQuery = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subscription_plans').select('*').eq('is_active', true).order('price');
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      {searchParameters.get('reason') === 'trial-expired' && (
        <Notice tone="error">Your free Supplier trial has ended. An active subscription is required before you can submit more bids.</Notice>
      )}
      <section className="card">
        <h2>Supplier Subscription</h2>
        <p>CaribbeanTender Supplier accounts include a 14-day free trial. After the trial ends, an active subscription is required to keep submitting bids.</p>
        <p>Business accounts remain free. Subscription requirements apply only to Supplier accounts.</p>
      </section>

      {plansQuery.isPending && <Loading />}
      {plansQuery.isError && <ErrorNotice error={plansQuery.error} />}
      {plansQuery.data && plansQuery.data.length === 0 && <Notice>Subscription plans have not been published yet.</Notice>}
      <section className="grid">
        {plansQuery.data?.map((plan) => (
          <div className="card" key={plan.id}>
            <h3>{plan.plan_name}</h3>
            <p>
              <strong>{new Intl.NumberFormat('en-JM', { style: 'currency', currency: plan.currency }).format(plan.price)}</strong> per{' '}
              {plan.interval_count > 1 ? `${plan.interval_count} ${plan.billing_interval}s` : plan.billing_interval}
            </p>
            {plan.description && <p>{plan.description}</p>}
            <button className="btn" type="button" disabled>Payment Coming Soon</button>
          </div>
        ))}
      </section>

      <Notice>Online subscription payments are not enabled yet. The payment buttons will work once the payment provider is connected.</Notice>
      <div className="actions">
        <Link className="btn" to="/supplier">Back to Supplier Dashboard</Link>
        <Link className="btn gold" to="/tenders">Browse Tenders</Link>
      </div>
    </>
  );
}
