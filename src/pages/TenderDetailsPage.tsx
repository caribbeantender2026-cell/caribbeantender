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
import { useCategories, useCompanyNames } from '../lib/queries.ts';
import { tenderPhase } from '../lib/rules.ts';
import { supabase } from '../lib/supabase.ts';

/** A tender and its recorded documents, as the signed-in user may see them. */
export function useTender(tenderId: string) {
  return useQuery({
    queryKey: ['tender', tenderId],
    queryFn: async () => {
      const [tenderResult, documentsResult, formResult] = await Promise.all([
        supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle(),
        supabase.from('tender_documents').select('id, file_name, document_role, size_bytes').eq('tender_id', tenderId).order('file_name'),
        supabase.from('form_submissions').select('form_key, form_version, data').eq('attached_to_type', 'tender').eq('attached_to_id', tenderId).maybeSingle(),
      ]);
      if (tenderResult.error) throw tenderResult.error;
      if (documentsResult.error) throw documentsResult.error;
      if (formResult.error) throw formResult.error;
      return { tender: tenderResult.data, documents: documentsResult.data, requirementsForm: formResult.data };
    },
  });
}

export function TenderDetailsPage() {
  const tenderId = useParams().tenderId ?? '';
  const { session, supplierProfile } = useAccount();
  const now = useNow();
  const tenderQuery = useTender(tenderId);
  const tender = tenderQuery.data?.tender ?? null;
  const namesQuery = useCompanyNames(tender ? [tender.business_id] : []);
  const categoriesQuery = useCategories();

  if (tenderQuery.isPending) return <Loading />;
  if (tenderQuery.isError) return <ErrorNotice error={tenderQuery.error} />;
  if (!tender) return <Notice tone="error">Tender not found. It may have been removed, or it isn't published yet.</Notice>;

  const isOwner = tender.business_id === session?.user.id;
  const isAcceptingBids = tenderPhase(tender, now) === 'accepting-bids';
  const categoryName = categoriesQuery.data?.find((category) => category.id === tender.category_id)?.name ?? 'Uncategorised';
  const requirementsForm = tenderQuery.data.requirementsForm;
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
        <Link to="/tenders">
          <ArrowLeftIcon aria-hidden="true" />
          Back to open tenders
        </Link>
      </Button>
      <TenderView
        tender={tender}
        now={now}
        businessName={namesQuery.data?.get(tender.business_id) ?? 'Business'}
        categoryName={categoryName}
        documents={tenderQuery.data.documents}
        requirementsForm={
          requirementsForm && (
            <AttachedForm
              formKey={requirementsForm.form_key}
              formVersion={requirementsForm.form_version}
              data={requirementsForm.data as FormData}
              notes={[`Requirements form for the tender "${tender.title}"`]}
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
