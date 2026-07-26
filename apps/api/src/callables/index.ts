// The callables this server serves. One list, mirroring
// `functions/src/index.ts`'s re-export block.
//
// ⚠️ The e2e callable-coverage guard (scripts/e2e-verify.mjs) fails if a served
// callable was never invoked by a test, and `scripts/lib/callableHardening.mjs`
// statically requires an auth marker on each one. DEPLOYMENT.md §4.1 says both
// guards must be RE-POINTED at this surface, not deleted — so adding an entry
// here without a test is meant to ship RED.

import type { CallableDefinition } from '../callable.js';
import type { ApiDeps } from '../deps.js';
import { getJoinInfo } from './getJoinInfo.js';
import { getMyProfile } from './getMyProfile.js';

export const ALL_CALLABLES: ReadonlyArray<CallableDefinition<ApiDeps>> = [
  getJoinInfo,
  getMyProfile,
];

export { getJoinInfo, getMyProfile };
