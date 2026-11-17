import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecoverySession } from '../../src/auth/recovery.ts';
import { publicSettingsProblem } from '../../src/lib/publicSettings.ts';

test('Recovery follows only the original Auth session and is consumed once', () => {
  const token = (id: string, expiry: number) => 'header.' + Buffer.from(JSON.stringify({ session_id: id, exp: expiry })).toString('base64url') + '.sig';
  const recovery = new RecoverySession();
  const session = { user: { id: 'user' }, access_token: token('session-a', 1) };
  recovery.observe('PASSWORD_RECOVERY', session);
  assert.ok(recovery.matches(session));
  assert.ok(recovery.matches({ ...session, access_token: token('session-a', 2) }));
  recovery.observe('SIGNED_IN', { ...session, access_token: token('session-b', 2) });
  assert.equal(recovery.matches(session), false);
  recovery.observe('PASSWORD_RECOVERY', session);
  recovery.clear();
  assert.equal(recovery.matches(session), false);
});

test('Production build configuration accepts only public Supabase keys', () => {
  const url = 'https://example.supabase.co';
  const jwt = (role: string) => 'header.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig';
  assert.equal(publicSettingsProblem(url, jwt('anon')), null);
  assert.equal(publicSettingsProblem(url, 'sb_publishable_test'), null);
  for (const credential of ['', 'sb_secret_fixture', jwt('service_role'), jwt('authenticated'), 'unknown']) {
    assert.ok(publicSettingsProblem(url, credential));
  }
  assert.ok(publicSettingsProblem('', 'sb_publishable_test'));
});
