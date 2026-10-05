/** Current Tenders: every tender open for bids, soonest-closing first. */
import { Link } from 'react-router';
import { ErrorNotice, Loading } from '../components/Notices.tsx';
import { useCompanyNames, useOpenTenders } from '../lib/queries.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

export function TendersPage() {
  const tendersQuery = useOpenTenders();
  const namesQuery = useCompanyNames('business_names_public', (tendersQuery.data ?? []).map((tender) => tender.business_id));

  return (
    <>
      <h2>Current Tenders</h2>
      <div className="card">
        <p>Browse private-sector procurement opportunities currently open for supplier bids. Closing times are in Jamaica time.</p>
        {tendersQuery.isPending && <Loading />}
        {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
        {tendersQuery.data && (
          <table className="table">
            <thead>
              <tr><th>Tender Title</th><th>Business</th><th>Closes</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {tendersQuery.data.length === 0 && (
                <tr><td colSpan={5}>No open tenders found.</td></tr>
              )}
              {tendersQuery.data.map((tender) => (
                <tr key={tender.id}>
                  <td>{tender.title}</td>
                  <td>{namesQuery.data?.get(tender.business_id) || 'Business'}</td>
                  <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                  <td><span className="badge open">Open</span></td>
                  <td><Link className="btn" to={`/tenders/${tender.id}`}>View Details</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
