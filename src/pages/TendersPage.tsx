/** Open tenders for signed-in users: soonest-closing first, filtered by one category, a page at a time (PRD P1-04). */
import { Link, useSearchParams } from 'react-router';
import { ChevronLeftIcon, ChevronRightIcon, Clock3Icon, SearchXIcon } from 'lucide-react';
import { AccountPicture } from '../components/AccountPicture.tsx';
import { CategoryOptions } from '../components/CategoryOptions.tsx';
import { ErrorNotice, Loading } from '../components/Notices.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Label, NativeSelect } from '../components/ui/fields.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { tendersPerPage, useCategories, useCompanies, useOpenTenders } from '../lib/queries.ts';
import { formatJamaicaDateTime, formatTimeLeft } from '../lib/time.ts';

/** Reads a whole number from the address bar, or the fallback for anything else. */
function wholeNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return value !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function TendersPage() {
  // Filter and page live in the address, so a link or the back button keeps them.
  const [searchParameters, setSearchParameters] = useSearchParams();
  const categoryId = searchParameters.get('category') ? wholeNumber(searchParameters.get('category'), 0) || null : null;
  const page = wholeNumber(searchParameters.get('page'), 0);
  const categoriesQuery = useCategories();
  const tendersQuery = useOpenTenders(categoryId, page);
  const tenders = tendersQuery.data?.tenders ?? [];
  const companiesQuery = useCompanies(tenders.map((tender) => tender.business_id), 'business');
  const categoryNames = new Map((categoriesQuery.data ?? []).map((category) => [category.id, category.name]));
  const pageCount = Math.max(1, Math.ceil((tendersQuery.data?.totalCount ?? 0) / tendersPerPage));

  function show(nextCategoryId: number | null, nextPage: number) {
    const next = new URLSearchParams();
    if (nextCategoryId !== null) next.set('category', String(nextCategoryId));
    if (nextPage > 0) next.set('page', String(nextPage));
    setSearchParameters(next);
  }

  const now = new Date();
  const businessName = (businessId: string) => companiesQuery.data?.get(businessId)?.companyName ?? 'Business';
  const businessPicture = (businessId: string) => <AccountPicture picturePath={companiesQuery.data?.get(businessId)?.picturePath} className="size-6 rounded-md" />;
  const categoryName = (id: number | null) => (id !== null ? (categoryNames.get(id) ?? 'Uncategorised') : 'Uncategorised');
  return (
    <>
      <PageHeader
        title="Open tenders"
        description="Tenders taking bids now, soonest closing first. Open one to read it and download its documents. All times are Jamaica time."
        actions={
          <div className="grid w-full gap-2 sm:w-64">
            <Label htmlFor="categoryFilter">Category</Label>
            <NativeSelect id="categoryFilter" value={categoryId ?? ''} onChange={(event) => show(event.target.value ? Number(event.target.value) : null, 0)}>
              <option value="">All categories</option>
              <CategoryOptions categories={categoriesQuery.data ?? []} />
            </NativeSelect>
          </div>
        }
      />
      {tendersQuery.isPending && <Loading />}
      {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
      {tendersQuery.data && tenders.length === 0 && (
        <Card className="items-center py-14 text-center">
          <SearchXIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No open tenders{categoryId !== null ? ' in this category right now. Try All categories.' : ' right now. New tenders appear here as soon as they are published.'}
          </p>
        </Card>
      )}
      {tenders.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          {/* Phones: one block per tender. */}
          <ul className="divide-y md:hidden">
            {tenders.map((tender) => (
              <li key={tender.id} className="relative p-4">
                <Link to={`/tenders/${tender.id}`} className="font-medium text-navy-dark after:absolute after:inset-0">{tender.title}</Link>
                <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                  {businessPicture(tender.business_id)}
                  <span className="min-w-0">{businessName(tender.business_id)} · {categoryName(tender.category_id)}</span>
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-sm tabular-nums">
                  <Clock3Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {formatTimeLeft(tender.closes_at, now) ?? 'Closing'} left
                </p>
              </li>
            ))}
          </ul>
          {/* Wider screens: the table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Tender</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Closes</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenders.map((tender) => (
                  <TableRow key={tender.id}>
                    <TableCell className="max-w-sm pl-5 font-medium">
                      <Link to={`/tenders/${tender.id}`} className="text-navy-dark">{tender.title}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-2">
                        {businessPicture(tender.business_id)}
                        {businessName(tender.business_id)}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="font-normal">{categoryName(tender.category_id)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatJamaicaDateTime(tender.closes_at)}
                      <span className="block text-xs text-muted-foreground">{formatTimeLeft(tender.closes_at, now) ?? 'Closing'} left</span>
                    </TableCell>
                    <TableCell className="pr-5"><Badge variant="open">Open</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pages">
          <Button variant="outline" size="sm" type="button" disabled={page === 0} onClick={() => show(categoryId, page - 1)}>
            <ChevronLeftIcon aria-hidden="true" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">Page {page + 1} of {pageCount}</span>
          <Button variant="outline" size="sm" type="button" disabled={page + 1 >= pageCount} onClick={() => show(categoryId, page + 1)}>
            Next
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </nav>
      )}
    </>
  );
}
