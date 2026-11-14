/** Open tenders for signed-in users: soonest-closing first, filtered by one category, a page at a time (PRD P1-04). */
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Notices.tsx';
import { tendersPerPage, useCategories, useCompanyNames, useOpenTenders } from '../lib/queries.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

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
  const namesQuery = useCompanyNames(tenders.map((tender) => tender.business_id));
  const categoryNames = new Map((categoriesQuery.data ?? []).map((category) => [category.id, category.name]));
  const pageCount = Math.max(1, Math.ceil((tendersQuery.data?.totalCount ?? 0) / tendersPerPage));

  function show(nextCategoryId: number | null, nextPage: number) {
    const next = new URLSearchParams();
    if (nextCategoryId !== null) next.set('category', String(nextCategoryId));
    if (nextPage > 0) next.set('page', String(nextPage));
    setSearchParameters(next);
  }

  return (
    <>
      <h2>Open tenders</h2>
      <div className="card">
        <label htmlFor="categoryFilter">Category</label>
        <select id="categoryFilter" value={categoryId ?? ''} onChange={(event) => show(event.target.value ? Number(event.target.value) : null, 0)}>
          <option value="">All categories</option>
          {(categoriesQuery.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <p className="small">Closing times are in Jamaica time.</p>
        {tendersQuery.isPending && <Loading />}
        {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
        {tendersQuery.data && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Tender</th><th>Business</th><th>Category</th><th>Closes</th><th>Status</th></tr>
              </thead>
              <tbody>
                {tenders.length === 0 && (
                  <tr><td colSpan={5}>No open tenders{categoryId !== null ? ' in this category' : ''}.</td></tr>
                )}
                {tenders.map((tender) => (
                  <tr key={tender.id}>
                    <td><Link to={`/tenders/${tender.id}`}>{tender.title}</Link></td>
                    <td>{namesQuery.data?.get(tender.business_id) ?? '—'}</td>
                    <td>{tender.category_id !== null ? (categoryNames.get(tender.category_id) ?? '—') : '—'}</td>
                    <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                    <td><span className="badge open">Open</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <nav className="actions" aria-label="Pages">
            <button type="button" className="btn outline" disabled={page === 0} onClick={() => show(categoryId, page - 1)}>Previous</button>
            <span className="small">Page {page + 1} of {pageCount}</span>
            <button type="button" className="btn outline" disabled={page + 1 >= pageCount} onClick={() => show(categoryId, page + 1)}>Next</button>
          </nav>
        )}
      </div>
    </>
  );
}
