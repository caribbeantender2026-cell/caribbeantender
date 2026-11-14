/**
 * Basic admin for pilot support (PRD P1-15): users, tenders, deactivating and reactivating a user, and
 * cancelling a tender. Staff must sign in with an authenticator app first (TOTP, aal2); the admin_*
 * functions check the staff role and aal2 themselves, so this page only decides what to show.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import type { Enums } from '../../lib/database.types.ts';
import { tenderPhaseDisplay, tenderPhase } from '../../lib/rules.ts';
import { errorMessage, supabase } from '../../lib/supabase.ts';
import { formatJamaicaDateTime } from '../../lib/time.ts';

const rowsPerPage = 50;
const totpCodePattern = /^\d{6}$/;

/** Enrols an authenticator app if needed, then verifies a code so the session reaches aal2. */
function MultiFactorGate({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const factorsQuery = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp;
    },
  });

  async function enrol() {
    setProblem(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error) return setProblem(errorMessage(error));
    setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(factorId: string) {
    setProblem(null);
    if (!totpCodePattern.test(code)) return setProblem('Enter the 6-digit code from your authenticator app.');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return setProblem(errorMessage(error));
    onVerified();
  }

  if (factorsQuery.isPending) return <Loading />;
  if (factorsQuery.isError) return <ErrorNotice error={factorsQuery.error} />;
  const factorId = enrolment?.factorId ?? factorsQuery.data[0]?.id;

  return (
    <div className="card form">
      <h3>Verify it's you</h3>
      {!factorId ? (
        <>
          <p>Admin pages need an authenticator app (such as Google Authenticator or 1Password). Set one up once.</p>
          <button type="button" className="btn" onClick={() => void enrol()}>Set up an authenticator app</button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verify(factorId);
          }}
        >
          {enrolment && (
            <>
              <p>Scan this code with your authenticator app, or enter the key by hand.</p>
              <img src={enrolment.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
              <p className="small">Key: <code>{enrolment.secret}</code></p>
            </>
          )}
          <label htmlFor="totpCode">6-digit code</label>
          <input id="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.trim())} />
          <button className="btn" type="submit">Verify</button>
        </form>
      )}
      {problem && <Notice tone="error">{problem}</Notice>}
    </div>
  );
}

function Users() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const usersQuery = useQuery({
    queryKey: ['admin-users', search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users', { search: search.trim(), page_size: rowsPerPage, page_offset: 0 });
      if (error) throw error;
      return data;
    },
  });

  async function setActive(userId: string, isActive: boolean, name: string) {
    setProblem(null);
    if (!window.confirm(`${isActive ? 'Reactivate' : 'Deactivate'} ${name}?`)) return;
    // The Edge Function records the change as this admin, then bans or unbans the account in Auth.
    const { error } = await supabase.functions.invoke('set-user-active', { body: { user_id: userId, is_active: isActive } });
    if (error) {
      const detail = error.context instanceof Response ? ((await error.context.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setProblem(detail ?? errorMessage(error));
    }
    await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  }

  return (
    <div className="card">
      <h3>Users</h3>
      <label htmlFor="userSearch">Search by name, email or company</label>
      <input id="userSearch" value={search} onChange={(event) => setSearch(event.target.value)} />
      {problem && <Notice tone="error">{problem}</Notice>}
      {usersQuery.isPending && <Loading />}
      {usersQuery.isError && <ErrorNotice error={usersQuery.error} />}
      {usersQuery.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Accounts</th><th>Trial ends</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {usersQuery.data.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.full_name}{user.staff_role && <> <span className="badge">{user.staff_role}</span></>}</td>
                  <td>{user.email}</td>
                  <td>{[user.business_name && `Business: ${user.business_name}`, user.supplier_name && `Supplier: ${user.supplier_name}`].filter(Boolean).join('; ') || '—'}</td>
                  <td>{user.trial_ends_at ? formatJamaicaDateTime(user.trial_ends_at) : '—'}{user.subscription_status ? ` (${user.subscription_status})` : ''}</td>
                  <td>{user.is_active ? 'Active' : 'Deactivated'}</td>
                  <td>
                    <button type="button" className="btn outline" onClick={() => void setActive(user.user_id, !user.is_active, user.full_name)}>
                      {user.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tenders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Enums<'tender_status'> | ''>('');
  const [problem, setProblem] = useState<string | null>(null);
  const tendersQuery = useQuery({
    queryKey: ['admin-tenders', statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_tenders', {
        page_size: rowsPerPage,
        page_offset: 0,
        ...(statusFilter ? { status_filter: statusFilter } : {}),
      });
      if (error) throw error;
      return data;
    },
  });

  async function cancel(tenderId: string, title: string) {
    setProblem(null);
    const reason = window.prompt(`Why is "${title}" being cancelled? The reason is shown to suppliers.`)?.trim();
    if (!reason) return;
    const { error } = await supabase.rpc('admin_cancel_tender', { tender_id: tenderId, reason });
    if (error) return setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['admin-tenders'] });
  }

  return (
    <div className="card">
      <h3>Tenders</h3>
      <label htmlFor="adminTenderStatus">Status</label>
      <select id="adminTenderStatus" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Enums<'tender_status'> | '')}>
        <option value="">All published</option>
        {(['open', 'closed', 'awarded', 'cancelled'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      {problem && <Notice tone="error">{problem}</Notice>}
      {tendersQuery.isPending && <Loading />}
      {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
      {tendersQuery.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Tender</th><th>Business</th><th>Category</th><th>Closes</th><th>Status</th><th>Bids</th><th>Action</th></tr>
            </thead>
            <tbody>
              {tendersQuery.data.map((tender) => {
                const phase = tenderPhase(tender);
                return (
                  <tr key={tender.tender_id}>
                    <td>{tender.title}</td>
                    <td>{tender.business_name || '—'}</td>
                    <td>{tender.category_name || '—'}</td>
                    <td>{formatJamaicaDateTime(tender.closes_at)}</td>
                    <td>{tenderPhaseDisplay[phase].label}</td>
                    {/* Sealed: no count before the closing time, not even for admins (PRD P1-09). */}
                    <td>{tender.bid_count ?? 'Sealed'}</td>
                    <td>
                      {(tender.status === 'open' || tender.status === 'closed') && (
                        <button type="button" className="btn outline" onClick={() => void cancel(tender.tender_id, tender.title)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const { staffRole } = useAccount();
  const assuranceQuery = useQuery({
    queryKey: ['assurance-level'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data.currentLevel;
    },
  });

  if (!staffRole) return <Notice tone="error">This page is for CaribbeanTender staff.</Notice>;
  if (assuranceQuery.isPending) return <Loading />;
  if (assuranceQuery.isError) return <ErrorNotice error={assuranceQuery.error} />;
  return (
    <>
      <h2>Admin</h2>
      {assuranceQuery.data !== 'aal2' ? (
        <MultiFactorGate onVerified={() => void assuranceQuery.refetch()} />
      ) : (
        <>
          <Users />
          <Tenders />
        </>
      )}
    </>
  );
}
