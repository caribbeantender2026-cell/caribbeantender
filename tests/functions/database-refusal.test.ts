// The server functions pass on the database's own refusals with a fitting status, and nothing else.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refusalReply } from '../../supabase/functions/_shared/database-refusal.ts';

test("The database's deliberate refusals keep their plain-English message and get a fitting status", () => {
  assert.deepEqual(refusalReply({ code: 'P0002', message: 'Document not found.' }), { status: 404, message: 'Document not found.' });
  assert.deepEqual(refusalReply({ code: '42501', message: 'This needs an admin account.' }), { status: 403, message: 'This needs an admin account.' });
  assert.deepEqual(refusalReply({ code: '23514', message: 'You cannot deactivate your own account.' }), { status: 400, message: 'You cannot deactivate your own account.' });
});

test('An expired or broken sign-in asks the person to log in again', () => {
  const reply = refusalReply({ code: 'PGRST303', message: 'JWT expired' });
  assert.equal(reply.status, 401);
  assert.match(reply.message, /Log in again/);
});

test('Anything else gets a generic message, never the raw database text', () => {
  for (const error of [
    { code: '57014', message: 'canceling statement due to statement timeout' },
    { code: '42883', message: 'function private.secret_helper(uuid) does not exist' },
    { message: 'TypeError: fetch failed' },
  ]) {
    const reply = refusalReply(error);
    assert.equal(reply.status, 500);
    assert.doesNotMatch(reply.message, /statement|private|fetch/);
  }
});
