/**
 * Basic admin for pilot support (PRD P1-15): users, tenders, deactivating and reactivating a user, and
 * cancelling a tender. Staff must sign in with an authenticator app first (TOTP, aal2); the admin_*
 * functions check the staff role and aal2 themselves, so this page only decides what to show.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../auth/AccountContext.tsx';
import { useConfirmation } from '../../components/ConfirmDialog.tsx';
import { ErrorNotice, Loading, Notice } from '../../components/Notices.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Field, Input, NativeSelect } from '../../components/ui/fields.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.tsx';
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
    <Card className="mb-6 max-w-3xl">
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Verify it's you</h3>
      </CardHeader>
      <CardContent>
        {!factorId ? (
          <>
            <p>Admin pages need an authenticator app (such as Google Authenticator or 1Password). Set one up once.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void enrol()}>Set up an authenticator app</Button>
            </div>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void verify(factorId);
            }}
          >
            {enrolment && (
              <>
                <p>Scan this code with your authenticator app, or enter the key by hand.</p>
                <img src={enrolment.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
                <p className="text-sm text-muted-foreground">Key: <code>{enrolment.secret}</code></p>
              </>
            )}
            <Field label="6-digit code" htmlFor="totpCode">
              <Input id="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.trim())} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Verify</Button>
            </div>
          </form>
        )}
        {problem && <Notice tone="error">{problem}</Notice>}
      </CardContent>
    </Card>
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

  const [confirmation, askToConfirm] = useConfirmation();

  async function setActive(userId: string, isActive: boolean, name: string) {
    setProblem(null);
    const { isConfirmed } = await askToConfirm(
      isActive
        ? { title: `Reactivate ${name}?`, message: 'They can post, bid and upload again.', confirmLabel: 'Reactivate', tone: 'go-ahead' }
        : { title: `Deactivate ${name}?`, message: "They won't be able to sign in, post, bid or upload until you reactivate them.", confirmLabel: 'Deactivate', tone: 'danger' },
    );
    if (!isConfirmed) return;
    // The Edge Function records the change as this admin, then bans or unbans the account in Auth.
    const { error } = await supabase.functions.invoke('set-user-active', { body: { user_id: userId, is_active: isActive } });
    if (error) {
      const detail = error.context instanceof Response ? ((await error.context.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setProblem(detail ?? errorMessage(error));
    }
    await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  }

  return (
    <Card className="mb-6">
      {confirmation}
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Users</h3>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Search by name, email or company" htmlFor="userSearch" className="max-w-sm">
          <Input id="userSearch" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        {problem && <Notice tone="error">{problem}</Notice>}
        {usersQuery.isPending && <Loading />}
        {usersQuery.isError && <ErrorNotice error={usersQuery.error} />}
        {usersQuery.data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Trial ends</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.data.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>{user.full_name}{user.staff_role && <> <Badge variant="secondary">{user.staff_role}</Badge></>}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{[user.business_name && `Business: ${user.business_name}`, user.supplier_name && `Supplier: ${user.supplier_name}`].filter(Boolean).join('; ') || '—'}</TableCell>
                  <TableCell>{user.trial_ends_at ? formatJamaicaDateTime(user.trial_ends_at) : '—'}{user.subscription_status ? ` (${user.subscription_status})` : ''}</TableCell>
                  <TableCell>{user.is_active ? 'Active' : 'Deactivated'}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline" onClick={() => void setActive(user.user_id, !user.is_active, user.full_name)}>
                      {user.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Tenders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Enums<'tender_status'> | ''>('');
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmation, askToConfirm] = useConfirmation();
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
    const { isConfirmed, reason } = await askToConfirm({
      title: `Cancel "${title}"?`,
      message: "Suppliers can no longer bid. This can't be undone.",
      reasonLabel: 'Reason (shown to suppliers)',
      confirmLabel: 'Cancel tender',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!isConfirmed) return;
    const { error } = await supabase.rpc('admin_cancel_tender', { tender_id: tenderId, reason });
    if (error) return setProblem(errorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ['admin-tenders'] });
  }

  return (
    <Card className="mb-6">
      {confirmation}
      <CardHeader>
        <h3 className="text-base font-semibold text-navy-dark">Tenders</h3>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Status" htmlFor="adminTenderStatus" className="max-w-sm">
          <NativeSelect id="adminTenderStatus" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Enums<'tender_status'> | '')}>
            <option value="">All published</option>
            {(['open', 'closed', 'awarded', 'cancelled'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
          </NativeSelect>
        </Field>
        {problem && <Notice tone="error">{problem}</Notice>}
        {tendersQuery.isPending && <Loading />}
        {tendersQuery.isError && <ErrorNotice error={tendersQuery.error} />}
        {tendersQuery.data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tender</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Closes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bids</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tendersQuery.data.map((tender) => {
                const phase = tenderPhase(tender);
                return (
                  <TableRow key={tender.tender_id}>
                    <TableCell>{tender.title}</TableCell>
                    <TableCell>{tender.business_name || '—'}</TableCell>
                    <TableCell>{tender.category_name || '—'}</TableCell>
                    <TableCell>{formatJamaicaDateTime(tender.closes_at)}</TableCell>
                    <TableCell>{tenderPhaseDisplay[phase].label}</TableCell>
                    {/* Sealed: no count before the closing time, not even for admins (PRD P1-09). */}
                    <TableCell>{tender.bid_count ?? 'Sealed'}</TableCell>
                    <TableCell>
                      {(tender.status === 'open' || tender.status === 'closed') && (
                        <Button type="button" variant="outline" onClick={() => void cancel(tender.tender_id, tender.title)}>Cancel</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
      <PageHeader title="Admin" description="Find users and tenders, deactivate or reactivate a user, and cancel a tender. You confirm it's you with your authenticator app first." />
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
