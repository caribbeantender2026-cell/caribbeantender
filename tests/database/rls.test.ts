// Every fix case against the fully migrated schema. All of them must pass.
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase } from './harness.ts';
import { fixSuites } from './fixes/index.ts';

let database: PGlite;

before(async () => {
  database = await createDatabase();
});

for (const suite of fixSuites) {
  describe(suite.title, () => {
    for (const fixCase of suite.cases) {
      test(fixCase.name, async () => {
        await fixCase.run(database);
      });
    }
  });
}
