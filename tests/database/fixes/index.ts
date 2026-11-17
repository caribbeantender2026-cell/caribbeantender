/** Every fix suite, in migration order. Each case is named after the audit item or PRD rule it proves. */
import type { FixSuite } from '../suite.ts';
import { companyNamesSuite, nameViewWritesSuite } from './01-c1-company-names.ts';
import { auditLogSuite, categoriesSuite, clientCategoriesSuite, closesAtSuite, subscriptionsSuite } from './02-audit-subscriptions-categories-deadlines.ts';
import { formsSuite, tenderLifecycleSuite } from './03-forms-lifecycle.ts';
import { bidRulesSuite, sealedBidsSuite } from './04-bids-sealed.ts';
import { signupSuite, storagePoliciesSuite } from './05-storage-signup.ts';
import { adminSuite, leastPrivilegeGrantsSuite, notificationsSuite } from './06-notifications-admin-grants.ts';

// Migrations without a suite of their own: 040060 (profile columns, exercised by the deactivation
// and onboarding cases), 040400 (enum values) and 040410 (document tables, exercised by the bid,
// storage and data-migration tests).
export const fixSuites: FixSuite[] = [
  nameViewWritesSuite,
  auditLogSuite,
  companyNamesSuite,
  subscriptionsSuite,
  categoriesSuite,
  closesAtSuite,
  formsSuite,
  tenderLifecycleSuite,
  bidRulesSuite,
  sealedBidsSuite,
  storagePoliciesSuite,
  signupSuite,
  notificationsSuite,
  adminSuite,
  leastPrivilegeGrantsSuite,
  clientCategoriesSuite,
];
