// Every fix case against the fully migrated schema. All of them must pass.
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase, listMigrations } from './harness.ts';
import { fixSuites } from './fixes/index.ts';

const migrations = listMigrations();
let database: PGlite;

before(async () => {
  database = await createDatabase(migrations);
});

for (const suite of fixSuites) {
  describe(suite.title, () => {
    for (const fixCase of suite.cases) {
      test(fixCase.name, async () => {
        await fixCase.run(database, migrations.at(-1)!);
      });
    }
  });
}
