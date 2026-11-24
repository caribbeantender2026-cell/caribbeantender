/** My tenders: every tender the business has posted, filtered by status, newest first (PRD P1-10). */
import { useState } from 'react';
import { Link } from 'react-router';
import { PlusIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Label, NativeSelect } from '../../components/ui/fields.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.tsx';
import { tenderPhase, tenderPhaseDisplay, type TenderPhase } from '../../lib/rules.ts';
import { supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

// The counts shown above the list: the phases a business acts on.
const summaryPhases: TenderPhase[] = ['accepting-bids', 'opened', 'awarded', 'draft'];

export function BusinessDashboardPage() {
  const { session } = useAccount();
  const businessId = session?.user.id ?? '';
  const [phaseFilter, setPhaseFilter] = useState<TenderPhase | ''>('');
  const tendersQuery = useQuery({
    queryKey: ['own-tenders', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenders')
        .select('id, title, status, closes_at, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const tenders = (tendersQuery.data ?? []).map((tender) => ({ ...tender, phase: tenderPhase(tender) }));
  const shown = phaseFilter === '' ? tenders : tenders.filter((tender) => tender.phase === phaseFilter);

  return (
    <>
      <PageHeader
        title="My tenders"
        description="View and manage all your tenders in one place, from the most recent to the oldest. Publish tenders, review submitted bids after the closing deadline, evaluate proposals, and award contracts to your preferred supplier."
      />
      {tendersQuery.data && tenders.length === 0 && (
        <Card className="items-center gap-3 px-6 py-14 text-center">
          <p className="font-serif text-2xl text-ink">You haven't posted a tender yet</p>
          <p className="max-w-md text-sm text-muted-foreground">Describe what you need, choose a closing date, and attach your documents. Suppliers in that category get an email.</p>
          <Button asChild variant="gold" className="mt-2">
            <Link to="/business/tenders/new">
              <PlusIcon aria-hidden="true" />
              Post your first tender
            </Link>
          </Button>
        </Card>
      )}
      {tendersQuery.data && tenders.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summaryPhases.map((phase) => (
            <Card key={phase} className="gap-1 py-5">
              <CardContent>
                <p className="text-sm text-muted-foreground">{tenderPhaseDisplay[phase].label}</p>
                <p className="mt-1 text-3xl font-semibold text-navy-dark tabular-nums">{tenders.filter((tender) => tender.phase === phase).length}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {tendersQuery.isPending && <Loading />}
      {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
      {tenders.length > 0 && (
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold text-navy-dark">Tenders</h3>
          <div className="flex items-center gap-2 sm:w-56">
            <Label htmlFor="phaseFilter" className="shrink-0">Status</Label>
            <div className="flex-1">
              <NativeSelect id="phaseFilter" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as TenderPhase | '')}>
                <option value="">All</option>
                {Object.entries(tenderPhaseDisplay).map(([phase, display]) => (
                  <option key={phase} value={phase}>{display.label}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>
        {tendersQuery.data && (
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Tender</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4">Closes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No tenders{phaseFilter ? ' with this status' : ' yet'}.
                  </TableCell>
                </TableRow>
              )}
              {shown.map((tender) => (
                <TableRow key={tender.id}>
                  <TableCell className="pl-4 font-medium">
                    <Link to={`/business/tenders/${tender.id}`} className="text-navy-dark">{tender.title}</Link>
                  </TableCell>
                  <TableCell><Badge variant={tenderPhaseDisplay[tender.phase].badgeStyle}>{tenderPhaseDisplay[tender.phase].label}</Badge></TableCell>
                  <TableCell className="pr-4 whitespace-nowrap tabular-nums">{formatJamaicaDateTime(tender.closes_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      )}
    </>
  );
}
