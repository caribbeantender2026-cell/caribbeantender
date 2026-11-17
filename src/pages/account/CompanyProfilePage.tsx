/** The company profile form, shared by business and supplier accounts. */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccount, type AccountType } from '../../auth/AccountContext.tsx';
import { AccountPicture, accountPicturesBucket } from '../../components/AccountPicture.tsx';
import { CategoryOptions } from '../../components/CategoryOptions.tsx';
import { Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Choice, Field, Input, NativeSelect, Textarea } from '../../components/ui/fields.tsx';
import { useCategories } from '../../lib/queries.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';

const maximumCompanyNameLength = 160;
const maximumAddressLength = 300;
const maximumPhoneLength = 40;
const maximumDescriptionLength = 2000;
// Account pictures show at 64 pixels at most; 256 stays sharp on high-density screens.
const maximumPictureSidePixels = 256;
const pictureQuality = 0.85;
// Every upload gets a new file name, so a cached picture never goes stale.
const oneYearSeconds = String(365 * 24 * 60 * 60);

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
    <PageHeader
      title="Company profile"
      description={
        accountType === 'business'
          ? 'How your company appears on the tenders you post.'
          : 'How your company appears on your bids. Your category decides which new tenders you are emailed about.'
      }
      back={{ to: dashboardPath, label: accountType === 'business' ? 'My tenders' : 'My bids' }}
    />
    {session && profile && <AccountPictureSetting accountType={accountType} userId={session.user.id} picturePath={profile.picture_path} />}
    <Card className="mb-6 max-w-3xl">
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(saveProfile)} noValidate>
          <Field label="Company Name" htmlFor="companyName" error={errors.companyName?.message}>
            <Input id="companyName" {...form.register('companyName')} />
          </Field>
          <Field label={accountType === 'business' ? 'Business Address' : 'Company Address'} htmlFor="companyAddress" error={errors.companyAddress?.message}>
            <Input id="companyAddress" autoComplete="street-address" {...form.register('companyAddress')} />
          </Field>
          {accountType === 'supplier' && (
            <Field label="Category (new tender alerts follow it)" htmlFor="categoryId" error={errors.categoryId?.message}>
              <NativeSelect id="categoryId" {...form.register('categoryId')}>
                <option value="">Select category</option>
                <CategoryOptions categories={categoriesQuery.data ?? []} />
              </NativeSelect>
            </Field>
          )}
          <Field label="Contact Number" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" autoComplete="tel" {...form.register('phone')} />
          </Field>
          <Field label="Email Address" htmlFor="contactEmail" error={errors.contactEmail?.message}>
            <Input id="contactEmail" type="email" autoComplete="email" {...form.register('contactEmail')} />
          </Field>
          <Field label="Company Description" htmlFor="description" error={errors.description?.message}>
            <Textarea id="description" {...form.register('description')} />
          </Field>
          {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save profile'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
    {accountType === 'supplier' && session && <TenderAlertsSetting userId={session.user.id} />}
    </>
  );
}

/**
 * Crops a picture to a centred square and shrinks it to at most 256 pixels, in the browser. Redrawing it
 * also drops photo metadata such as GPS location. WebP where the browser can encode it, PNG otherwise.
 */
async function shrinkPicture(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`"${file.name}" isn't a picture this browser can open. Choose a PNG, JPEG or WebP image.`);
  }
  const sourceSide = Math.min(bitmap.width, bitmap.height);
  const pictureSide = Math.min(sourceSide, maximumPictureSidePixels);
  const canvas = document.createElement('canvas');
  canvas.width = pictureSide;
  canvas.height = pictureSide;
  const context = canvas.getContext('2d');
  if (!context) throw new Error("This browser can't prepare pictures. Try another browser.");
  context.drawImage(bitmap, (bitmap.width - sourceSide) / 2, (bitmap.height - sourceSide) / 2, sourceSide, sourceSide, 0, 0, pictureSide, pictureSide);
  bitmap.close();
  const picture = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', pictureQuality));
  if (!picture) throw new Error(`Unable to prepare "${file.name}". Try a different picture.`);
  return picture;
}

/** Lets the account add, change or remove the picture shown next to its company name. */
function AccountPictureSetting({ accountType, userId, picturePath }: { accountType: AccountType; userId: string; picturePath: string | null }) {
  const { refreshAccounts } = useAccount();
  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const table = accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  const pictures = supabase.storage.from(accountPicturesBucket);

  async function save(change: () => Promise<void>) {
    setProblem(null);
    setIsSaving(true);
    try {
      await change();
      await refreshAccounts();
    } catch (error) {
      setProblem(`Unable to save the picture: ${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  // The profile already points elsewhere, so a file left behind only costs storage; it isn't worth failing over.
  async function removeFile(path: string) {
    const removed = await pictures.remove([path]);
    if (removed.error) console.error(`Unable to remove the old picture file ${path}:`, removed.error);
  }

  async function upload(file: File) {
    const picture = await shrinkPicture(file);
    const newPath = `${userId}/${crypto.randomUUID()}.${picture.type === 'image/webp' ? 'webp' : 'png'}`;
    const uploaded = await pictures.upload(newPath, picture, { contentType: picture.type, cacheControl: oneYearSeconds });
    if (uploaded.error) throw uploaded.error;
    const { error } = await supabase.from(table).update({ picture_path: newPath }).eq('user_id', userId);
    if (error) {
      await removeFile(newPath);
      throw error;
    }
    if (picturePath) await removeFile(picturePath);
  }

  async function remove(path: string) {
    const { error } = await supabase.from(table).update({ picture_path: null }).eq('user_id', userId);
    if (error) throw error;
    await removeFile(path);
  }

  return (
    <Card className="mb-6 max-w-3xl">
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Picture</h3>
        <p className="text-sm text-ink/70">
          Shown next to your company name on your {accountType === 'business' ? 'tenders' : 'bids'}, and in your menu. Any picture you like; it is cropped to a square.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4">
          <AccountPicture picturePath={picturePath} className="size-16 rounded-xl" />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file again still counts as a change.
              event.target.value = '';
              if (file) void save(() => upload(file));
            }}
          />
          <Button type="button" variant="outline" disabled={isSaving} onClick={() => fileInput.current?.click()}>
            {isSaving ? 'Saving…' : picturePath ? 'Change picture' : 'Upload a picture'}
          </Button>
          {picturePath && (
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => void save(() => remove(picturePath))}>
              Remove picture
            </Button>
          )}
        </div>
        {problem && <Notice tone="error">{problem}</Notice>}
      </CardContent>
    </Card>
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
    <Card className="mb-6 max-w-3xl">
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Email settings</h3>
      </CardHeader>
      <CardContent>
        <Choice id="tenderAlerts" type="checkbox" checked={tenderAlerts} onChange={(event) => void change(event.target.checked)}>
          Email me when a new tender is published in my category
        </Choice>
        {problem && <Notice tone="error">{problem}</Notice>}
      </CardContent>
    </Card>
  );
}

export const BusinessProfilePage = () => <CompanyProfilePage accountType="business" />;
export const SupplierProfilePage = () => <CompanyProfilePage accountType="supplier" />;
