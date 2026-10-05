// Proves each fix: its cases run against the schema just before its migration (they must fail,
// except regression guards) and again just after it (they must all pass).
import { applyMigration, createDatabase, listMigrations } from './harness.ts';
import { fixSuites } from './fixes/index.ts';
import type { FixCase } from './suite.ts';

type CaseOutcome = { passed: boolean; reason: string };

async function runCase(fixCase: FixCase, database: Awaited<ReturnType<typeof createDatabase>>): Promise<CaseOutcome> {
  try {
    await fixCase.run(database);
    return { passed: true, reason: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { passed: false, reason: message.split('\n')[0] ?? message };
  }
}

const allMigrations = listMigrations();
let unexpectedResults = 0;

for (const suite of fixSuites) {
  const migrationIndex = allMigrations.indexOf(suite.migration);
  if (migrationIndex < 0) {
    throw new Error(`Migration not found: ${suite.migration}`);
  }
  console.log(`\n${suite.title}\n  ${suite.migration}`);

  // A fresh database per phase, so fixtures from the "before" run cannot leak into the "after" run.
  const databaseBefore = await createDatabase(allMigrations.slice(0, migrationIndex));
  const databaseAfter = await createDatabase(allMigrations.slice(0, migrationIndex));
  await applyMigration(databaseAfter, suite.migration);

  for (const fixCase of suite.cases) {
    const beforeOutcome = await runCase(fixCase, databaseBefore);
    const afterOutcome = await runCase(fixCase, databaseAfter);
    const expectedBefore = fixCase.alreadyHeldBefore === true;
    const asExpected = beforeOutcome.passed === expectedBefore && afterOutcome.passed;
    if (!asExpected) {
      unexpectedResults += 1;
    }
    const beforeLabel = beforeOutcome.passed ? 'pass' : 'FAIL';
    const afterLabel = afterOutcome.passed ? 'pass' : 'FAIL';
    const guardLabel = expectedBefore ? ' (regression guard)' : '';
    console.log(`  ${asExpected ? 'ok        ' : 'UNEXPECTED'} before ${beforeLabel} -> after ${afterLabel} | ${fixCase.name}${guardLabel}`);
    if (!beforeOutcome.passed) {
      console.log(`             before: ${beforeOutcome.reason}`);
    }
    if (!afterOutcome.passed) {
      console.log(`             after:  ${afterOutcome.reason}`);
    }
  }
  await databaseBefore.close();
  await databaseAfter.close();
}

console.log(unexpectedResults === 0 ? '\nEvery fix fails before its migration and passes after it.' : `\n${unexpectedResults} unexpected result(s).`);
process.exitCode = unexpectedResults === 0 ? 0 : 1;
