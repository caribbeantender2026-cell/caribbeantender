/** The public homepage: what the platform does, and buttons to sign up or sign in (PRD P1-12). Static: visitors read no data. */
import { Link } from 'react-router';
import { useAccount } from '../auth/AccountContext.tsx';

export function HomePage() {
  const { session } = useAccount();
  return (
    <section className="hero">
      <div>
        <h2>eTendering for the private sector</h2>
        <p>
          CaribbeanTender is a procurement platform where businesses publish tenders and suppliers submit sealed bids
          electronically.
        </p>
        <p>Bids stay sealed until each tender's closing time. Every deadline is shown in Jamaica time.</p>
        <div className="actions">
          {session ? (
            <Link className="btn" to="/tenders">Browse open tenders</Link>
          ) : (
            <>
              <Link className="btn" to="/register">Sign up</Link>
              <Link className="btn gold" to="/login">Sign in</Link>
            </>
          )}
        </div>
      </div>
      <aside className="card">
        <h3>How it works</h3>
        <ul className="links">
          <li>Businesses post a tender with its requirements and a closing time.</li>
          <li>Suppliers bid before the closing time. Nobody, not even the business, can see a bid before then.</li>
          <li>At the closing time the business sees every bid and awards one.</li>
        </ul>
      </aside>
    </section>
  );
}
