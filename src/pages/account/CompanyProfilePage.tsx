/** The company profile form, shared by business and supplier accounts. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccount, type AccountType } from '../../auth/AccountContext.tsx';
import { Notice } from '../../components/Notices.tsx';
import { useCategories } from '../../lib/queries.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const maximumCompanyNameLength = 160;
const maximumAddressLength = 300;
const maximumPhoneLength = 40;
const maximumDescriptionLength = 2000;

const profileSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the company name.').max(maximumCompanyNameLength, `Use at most ${maximumCompanyNameLength} characters.`),
  companyAddress: z.string().trim().min(1, 'Enter the company address.').max(maximumAddressLength, `Use at most ${maximumAddressLength} characters.`),
  categoryId: z.string(),
  phone: z.string().trim().min(1, 'Enter a contact number.').max(maximumPhoneLength, `Use at most ${maximumPhoneLength} characters.`),
  contactEmail: z.email('Enter a valid contact email address.'),
  description: z.string().trim().min(1, 'Describe the company.').max(maximumDescriptionLength, `Use at most ${maximumDescriptionLength} characters.`),
});
type ProfileValues = z.infer<typeof profileSchema>;

export function CompanyProfilePage({ accountType }: { accountType: AccountType }) {
  const { session, businessProfile, supplierProfile, refreshAccounts } = useAccount();
  const categoriesQuery = useCategories();
  const profile = accountType === 'business' ? businessProfile : supplierProfile;
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(
      accountType === 'supplier'
        ? profileSchema.extend({ categoryId: z.string().min(1, 'Choose a category.') })
        : profileSchema,
    ),
    defaultValues: {
      companyName: profile?.company_name ?? '',
      companyAddress: profile?.company_address ?? '',
      categoryId: supplierProfile?.category_id?.toString() ?? '',
      phone: profile?.phone ?? '',
      contactEmail: profile?.contact_email ?? '',
      description: profile?.description ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const dashboardPath = accountType === 'business' ? '/business' : '/supplier';

  async function saveProfile(values: ProfileValues) {
    if (!session) return;
    setOutcome(null);
    const sharedChanges = {
      company_name: values.companyName,
      company_address: values.companyAddress,
      phone: values.phone,
      contact_email: values.contactEmail,
      description: values.description,
    };
    const { error } =
      accountType === 'business'
        ? await supabase.from('business_profiles').update(sharedChanges).eq('user_id', session.user.id)
        : await supabase.from('supplier_profiles').update({ ...sharedChanges, category_id: Number(values.categoryId) }).eq('user_id', session.user.id);
    if (error) {
      setOutcome({ tone: 'error', text: `Unable to save the profile: ${errorMessage(error)}` });
      return;
    }
    await refreshAccounts();
    setOutcome({ tone: 'success', text: 'Profile saved.' });
  }

  return (
    <>
    <div className="card form">
      <h2>{accountType === 'business' ? 'Business Company Profile' : 'Supplier Profile'}</h2>
      <form onSubmit={form.handleSubmit(saveProfile)} noValidate>
        <label htmlFor="companyName">Company Name</label>
        <input id="companyName" {...form.register('companyName')} />
        {errors.companyName && <div className="match-error">{errors.companyName.message}</div>}

        <label htmlFor="companyAddress">{accountType === 'business' ? 'Business Address' : 'Company Address'}</label>
        <input id="companyAddress" autoComplete="street-address" {...form.register('companyAddress')} />
        {errors.companyAddress && <div className="match-error">{errors.companyAddress.message}</div>}

        {accountType === 'supplier' && (
          <>
            <label htmlFor="categoryId">Category (new tender alerts follow it)</label>
            <select id="categoryId" {...form.register('categoryId')}>
              <option value="">Select category</option>
              {(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            {errors.categoryId && <div className="match-error">{errors.categoryId.message}</div>}
          </>
        )}

        <label htmlFor="phone">Contact Number</label>
        <input id="phone" type="tel" autoComplete="tel" {...form.register('phone')} />
        {errors.phone && <div className="match-error">{errors.phone.message}</div>}

        <label htmlFor="contactEmail">Email Address</label>
        <input id="contactEmail" type="email" autoComplete="email" {...form.register('contactEmail')} />
        {errors.contactEmail && <div className="match-error">{errors.contactEmail.message}</div>}

        <label htmlFor="description">Company Description</label>
        <textarea id="description" {...form.register('description')} />
        {errors.description && <div className="match-error">{errors.description.message}</div>}

        {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
        <div className="actions">
          <button className="btn" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save Profile'}</button>
          <Link className="btn gold" to={dashboardPath}>Back to Dashboard</Link>
        </div>
      </form>
    </div>
    {accountType === 'supplier' && session && <TenderAlertsSetting userId={session.user.id} />}
    </>
  );
}

/** Lets a supplier turn new-tender emails off and on (PRD P1-13). No row means alerts are on. */
function TenderAlertsSetting({ userId }: { userId: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const preferenceQuery = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_preferences').select('tender_alerts').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function change(tenderAlerts: boolean) {
    setProblem(null);
    // Update or insert, not upsert: users may not update user_id, which an upsert writes.
    const { error } = preferenceQuery.data
      ? await supabase.from('notification_preferences').update({ tender_alerts: tenderAlerts }).eq('user_id', userId)
      : await supabase.from('notification_preferences').insert({ user_id: userId, tender_alerts: tenderAlerts });
    if (error) setProblem(errorMessage(error));
    await preferenceQuery.refetch();
  }

  if (preferenceQuery.isPending) return null;
  const tenderAlerts = preferenceQuery.data?.tender_alerts ?? true;
  return (
    <div className="card form">
      <h3>Email settings</h3>
      <label className="checkbox" htmlFor="tenderAlerts">
        <input id="tenderAlerts" type="checkbox" checked={tenderAlerts} onChange={(event) => void change(event.target.checked)} />
        Email me when a new tender is published in my category
      </label>
      {problem && <Notice tone="error">{problem}</Notice>}
    </div>
  );
}

export const BusinessProfilePage = () => <CompanyProfilePage accountType="business" />;
export const SupplierProfilePage = () => <CompanyProfilePage accountType="supplier" />;
