/** Shown for any address the app does not know. */
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="card">
      <h2>Page not found</h2>
      <p>That address does not exist. It may be an old link from the previous version of the site.</p>
      <div className="actions">
        <Link className="btn" to="/">Go to the homepage</Link>
        <Link className="btn gold" to="/tenders">View current tenders</Link>
      </div>
    </div>
  );
}
