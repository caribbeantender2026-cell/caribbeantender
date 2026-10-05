import type { FixSuite } from '../suite.ts';
import { companyNamesSuite } from './01-company-names.ts';
import { subscriptionsSuite } from './02-subscriptions.ts';
import { closesAtSuite } from './03-closes-at.ts';
import { tenderLifecycleSuite } from './05-tender-lifecycle.ts';
import { bidRulesSuite } from './06-bid-rules.ts';
import { sealedBidsSuite } from './07-sealed-bids.ts';
import { auditLogSuite } from './08-audit-log.ts';
import { storagePoliciesSuite } from './09-storage-policies.ts';
import { signupNamesSuite } from './10-signup-names.ts';
import { leastPrivilegeGrantsSuite } from './11-least-privilege-grants.ts';

// In migration order. 20261005040400_tender_status_values.sql has no suite of its own: it only adds
// enum values, and the lifecycle suite exercises them.
export const fixSuites: FixSuite[] = [
  companyNamesSuite,
  subscriptionsSuite,
  closesAtSuite,
  tenderLifecycleSuite,
  bidRulesSuite,
  sealedBidsSuite,
  auditLogSuite,
  storagePoliciesSuite,
  signupNamesSuite,
  leastPrivilegeGrantsSuite,
];
