import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { FixSuite } from '../suite.ts';

// Inserts an auth.users row the way Supabase Auth does at sign-up, so the signup trigger runs.
async function signUp(database: PGlite, email: string, metadata: Record<string, unknown>): Promise<{ fullName: string; accountType: string | null }> {
  const userId = randomUUID();
  await database.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [userId, email, JSON.stringify(metadata)]);
  const profile = await database.query<{ full_name: string; account_type: string | null }>(`select full_name, account_type from public.profiles where id = $1`, [userId]);
  const row = profile.rows[0];
  assert.ok(row, 'a profile is created');
  return { fullName: row.full_name, accountType: row.account_type };
}

export const signupNamesSuite: FixSuite = {
  migration: '20261005041000_signup_names.sql',
  title: 'P2: sign-up never fails because of the name',
  cases: [
    {
      name: 'Sign-up with a one-letter name succeeds',
      run: async (database) => {
        const profile = await signUp(database, `jo${randomUUID().slice(0, 6)}@example.test`, { full_name: 'J', account_type: 'supplier' });
        assert.ok(profile.fullName.length >= 2);
      },
    },
    {
      name: 'Sign-up with a name made only of spaces succeeds',
      run: async (database) => {
        const profile = await signUp(database, `spaces${randomUUID().slice(0, 6)}@example.test`, { full_name: '   ', account_type: 'business' });
        assert.ok(profile.fullName.trim().length >= 2);
      },
    },
    {
      name: 'Sign-up without any metadata (for example, from the dashboard) succeeds',
      run: async (database) => {
        const profile = await signUp(database, `a@example.test`, {});
        assert.equal(profile.fullName, 'New user');
      },
    },
    {
      name: 'A name over 120 characters is shortened instead of failing',
      run: async (database) => {
        const profile = await signUp(database, `long${randomUUID().slice(0, 6)}@example.test`, { full_name: 'N'.repeat(200), account_type: 'supplier' });
        assert.equal(profile.fullName.length, 120);
      },
    },
    {
      name: 'Sign-up records the account type on the profile',
      run: async (database) => {
        const profile = await signUp(database, `type${randomUUID().slice(0, 6)}@example.test`, { full_name: 'Kim Brown', account_type: 'business' });
        assert.equal(profile.accountType, 'business');
      },
    },
    {
      name: 'A normal name is kept as entered',
      alreadyHeldBefore: true,
      run: async (database) => {
        const profile = await signUp(database, `normal${randomUUID().slice(0, 6)}@example.test`, { full_name: 'Kim Brown', account_type: 'supplier' });
        assert.equal(profile.fullName, 'Kim Brown');
      },
    },
  ],
};
