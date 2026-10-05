/** The homepage: what the service is, and the latest tenders open for bids. */
import { Link } from 'react-router';
import { ErrorNotice, Loading } from '../components/Notices.tsx';
import { useCompanyNames, useOpenTenders } from '../lib/queries.ts';
import { formatJamaicaDateTime } from '../lib/time.ts';

const latestTenderCount = 5;

export function HomePage() {
  const tendersQuery = useOpenTenders(latestTenderCount);
  const namesQuery = useCompanyNames('business_names_public', (tendersQuery.data ?? []).map((tender) => tender.business_id));

  return (
    <>
      <section className="hero">
        <div>
          <h2>eTendering System</h2>
          <p>
            CaribbeanTender is a private-sector procurement platform where businesses publish tenders and suppliers
            submit sealed bids electronically.
          </p>
          <p>Bids stay sealed until each tender's closing time. Every deadline is shown in Jamaica time.</p>
          <div className="actions">
            <Link className="btn" to="/register">Register Your Account</Link>
            <Link className="btn gold" to="/tenders">View Current Tenders</Link>
          </div>
        </div>
        <aside className="card">
          <h3>Log in</h3>
          <ul className="links">
            <li><Link to="/login">Log in to your account</Link></li>
            <li><Link to="/register">Register as a Business</Link></li>
            <li><Link to="/register">Register as a Supplier</Link></li>
          </ul>
        </aside>
      </section>

      <section className="grid">
        <div>
          <div className="card">
            <h3>Information</h3>
            <table className="table">
              <tbody>
                <tr><th>Service</th><th>Description</th></tr>
                <tr><td>Businesses</td><td>Create a profile, post tenders and open the bids once the deadline passes.</td></tr>
                <tr><td>Suppliers</td><td>Create a profile, browse open tenders and submit sealed bid proposals.</td></tr>
                <tr><td>Current Tenders</td><td>View procurement opportunities currently open for bidding.</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Latest Tender Opportunities</h3>
            {tendersQuery.isPending && <Loading />}
            {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
            {tendersQuery.data && (
              <table className="table">
                <thead>
                  <tr><th>Tender</th><th>Business</th><th>Closes (Jamaica time)</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {tendersQuery.data.length === 0 && (
                    <tr><td colSpan={4}>No tenders are open right now.</td></tr>
                  )}
                  {tendersQuery.data.map((tender) => (
                    <tr key={tender.id}>
                      <td>{tender.title}</td>
                      <td>{namesQuery.data?.get(tender.business_id) || 'Business'}</td>
                      <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                      <td><Link to={`/tenders/${tender.id}`}>View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <aside>
          <div className="card">
            <h3>Assistance</h3>
            <ul className="links">
              <li><Link to="/register">Register yourself and your organisation</Link></li>
              <li><Link to="/tenders">View current tender publications</Link></li>
              <li><Link to="/login">Log in to access your account dashboard</Link></li>
            </ul>
          </div>
        </aside>
      </section>
    </>
  );
}
