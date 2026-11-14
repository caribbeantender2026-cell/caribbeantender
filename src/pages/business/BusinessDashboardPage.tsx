/** My tenders: every tender the business has posted, filtered by status, newest first (PRD P1-10). */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading } from '../../components/Notices.tsx';
import { tenderPhase, tenderPhaseDisplay, type TenderPhase } from '../../lib/rules.ts';
import { supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

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
      <h2>My tenders</h2>
      <div className="card">
        <div className="actions">
          <Link className="btn gold" to="/business/tenders/new">Post a tender</Link>
        </div>
        <label htmlFor="phaseFilter">Status</label>
        <select id="phaseFilter" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value as TenderPhase | '')}>
          <option value="">All</option>
          {Object.entries(tenderPhaseDisplay).map(([phase, display]) => (
            <option key={phase} value={phase}>{display.label}</option>
          ))}
        </select>
        {tendersQuery.isPending && <Loading />}
        {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
        {tendersQuery.data && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Tender</th><th>Status</th><th>Closes</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={3}>No tenders{phaseFilter ? ' with this status' : ' yet'}.</td></tr>}
                {shown.map((tender) => (
                  <tr key={tender.id}>
                    <td><Link to={`/business/tenders/${tender.id}`}>{tender.title}</Link></td>
                    <td><span className={`badge ${tenderPhaseDisplay[tender.phase].badgeStyle}`}>{tenderPhaseDisplay[tender.phase].label}</span></td>
                    <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
