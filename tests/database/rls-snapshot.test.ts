/** The live runner detects replaced rows using only opaque values in memory. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { compareIdentitySnapshots, createSnapshotSalt, readIdentitySnapshot } from '../../scripts/rls-snapshot.ts';

test('A replacement with the same row count is flagged without exporting names or contents', async () => {
  const database = await PGlite.create();
  try {
    await database.exec("create table public.sample(company text, version integer, answer text, primary key(company,version)); insert into public.sample values ('Sample company',1,'Private answer')");
    const readRows = async <Row>(statement: string) => (await database.query<Row>(statement)).rows;
    const salt = createSnapshotSalt();
    const before = await readIdentitySnapshot(readRows, salt);
    assert.match([...(before.get('public.sample') ?? [])][0] ?? '', /^[0-9a-f]{64}$/);
    await database.exec("update public.sample set answer='Changed answer'; insert into public.sample values ('Second',1,'New answer')");
    const afterAddition = await readIdentitySnapshot(readRows, salt);
    assert.equal(compareIdentitySnapshots(before, afterAddition).needsReview, false);
    await database.exec("update public.sample set version=2 where company='Sample company'");
    const compared = compareIdentitySnapshots(afterAddition, await readIdentitySnapshot(readRows, salt));
    assert.equal(compared.needsReview, true);
    assert.match(compared.report, /2 \| 2 \| 1 \| 1/);
    assert.doesNotMatch(compared.report, /Sample company|answer/i);
  } finally {
    await database.close();
  }
});
