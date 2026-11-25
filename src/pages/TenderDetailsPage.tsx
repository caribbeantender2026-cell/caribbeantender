/** One tender for signed-in users: details, closing time with a countdown, and its documents (PRD P1-05). */
import { Link, useParams } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../auth/AccountContext.tsx';
import { AttachedForm } from '../components/FormFields.tsx';
import type { FormData } from '../lib/forms.ts';
import { ErrorNotice, Loading, Notice } from '../components/Notices.tsx';
import { TenderView, useNow } from '../components/TenderView.tsx';
import { Button } from '../components/ui/button.tsx';
import { useCategories, useCompanies } from '../lib/queries.ts';
import { supabase } from '../lib/supabase.ts';

// The close job sets "closed" within a minute of the closing time.
const closingCheckMilliseconds = 10_000;
const maximumTimerMilliseconds = 2_147_483_647;

/** Add monotonic elapsed time to a database timestamp, independent of the device's clock settings. */
export function tenderServerTime(sample: { serverMilliseconds: number; observedMilliseconds: number }): Date {
  return new Date(sample.serverMilliseconds + performance.now() - sample.observedMilliseconds);
}

/** Read tender details and current bid eligibility using the database clock. */
export function useTender(tenderId: string) {
  const { session } = useAccount();
  return useQuery({
    queryKey: ['tender', tenderId, session?.user.id],
    refetchInterval: (query) => {
      const result = query.state.data;
      if (result?.tender?.status !== 'open') return false;
      const remaining = Date.parse(result.tender.closes_at) - tenderServerTime(result).getTime();
      return remaining > 0 ? Math.min(maximumTimerMilliseconds, Math.ceil(remaining)) : closingCheckMilliseconds;
    },
    queryFn: async () => {
      const [tenderResult, documentsResult, formResult, clockResult] = await Promise.all([
        supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle(),
        supabase.from('tender_documents').select('id, file_name, document_role, size_bytes').eq('tender_id', tenderId).order('file_name'),
        supabase.from('form_submissions').select('form_key, form_version, data').eq('attached_to_type', 'tender').eq('attached_to_id', tenderId).maybeSingle(),
        supabase.rpc('server_time').then(({ data, error }) => {
          if (error) throw error;
          return { serverMilliseconds: Date.parse(data), observedMilliseconds: performance.now() };
        }),
      ]);
      if (tenderResult.error) throw tenderResult.error;
      if (documentsResult.error) throw documentsResult.error;
      if (formResult.error) throw formResult.error;
      return { ...clockResult, tender: tenderResult.data, documents: documentsResult.data, requirementsForm: formResult.data };
    },
  });
}

export function TenderDetailsPage() {
  const tenderId = useParams().tenderId ?? '';
  const { session, supplierProfile } = useAccount();
  useNow(); // Tick the displayed server time between reads.
  const tenderQuery = useTender(tenderId);
  const tender = tenderQuery.data?.tender ?? null;
  const companiesQuery = useCompanies(tender ? [tender.business_id] : [], 'business');
  const categoriesQuery = useCategories();

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (!tender) return <Notice tone="error">Tender not found. It may have been removed, or it isn't published yet.</Notice>;

  const isOwner = tender.business_id === session?.user.id;
  const now = tenderServerTime(tenderQuery.data);
  const isAcceptingBids = tender.status === 'open' && Date.parse(tender.closes_at) > now.getTime();
  const categoryName = categoriesQuery.data?.find((category) => category.id === tender.category_id)?.name ?? 'Uncategorised';
  const requirementsForm = tenderQuery.data.requirementsForm;
  return (
    <>
      <Link to="/tenders" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 no-underline hover:text-ink hover:no-underline">
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Back to open tenders
      </Link>
      <TenderView
        tender={tender}
        now={now}
        businessName={companiesQuery.data?.get(tender.business_id)?.companyName ?? 'Business'}
        businessPicturePath={companiesQuery.data?.get(tender.business_id)?.picturePath}
        categoryName={categoryName}
        documents={tenderQuery.data.documents}
        requirementsForm={
          requirementsForm && (
            <AttachedForm
              formKey={requirementsForm.form_key}
              formVersion={requirementsForm.form_version}
              data={requirementsForm.data as FormData}
              notes={[`Tender Creation Form for the tender "${tender.title}"`]}
            />
          )
        }
        actions={
          <>
            {isOwner && (
              <Button asChild className="w-full">
                <Link to={`/business/tenders/${tender.id}`}>Manage this tender</Link>
              </Button>
            )}
            {!isOwner && supplierProfile && isAcceptingBids && (
              <Button asChild variant="gold" className="w-full">
                <Link to={`/tenders/${tender.id}/bid`}>Submit a bid</Link>
              </Button>
            )}
          </>
        }
      />
    </>
  );
}
