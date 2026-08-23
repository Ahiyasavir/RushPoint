// Pure-logic test for portsToAwait (change: emulator-exec-port-race).
//   npx tsx scripts/test-port-readiness.ts
import { portsToAwait } from './lib/portReadiness.mjs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const PORTS = { auth: 9099, functions: 5001, firestore: 8080, storage: 9199, ui: 4000, hosting: 5002 };

check('single service maps to its one port',
  JSON.stringify(portsToAwait('firestore', PORTS)) === JSON.stringify([8080]));
check('multi-service maps in given order',
  JSON.stringify(portsToAwait('firestore,storage', PORTS)) === JSON.stringify([8080, 9199]));
check('default four-service list maps to four ports',
  JSON.stringify(portsToAwait('firestore,auth,functions,storage', PORTS))
    === JSON.stringify([8080, 9099, 5001, 9199]));
check('whitespace around names is forgiven',
  JSON.stringify(portsToAwait(' firestore , storage ', PORTS)) === JSON.stringify([8080, 9199]));
check('an unknown service name is skipped, not crashed on',
  JSON.stringify(portsToAwait('firestore,bogus', PORTS)) === JSON.stringify([8080]));
check('a duplicated service name only waits on the port once',
  JSON.stringify(portsToAwait('firestore,firestore', PORTS)) === JSON.stringify([8080]));
check('empty/undefined only → nothing to wait on',
  portsToAwait('', PORTS).length === 0 && portsToAwait(undefined as unknown as string, PORTS).length === 0);
check('a missing ports table entry is skipped, not NaN',
  JSON.stringify(portsToAwait('firestore,eventarc', PORTS)) === JSON.stringify([8080]));

console.log(`\n${failures === 0 ? 'ALL PORT-READINESS TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
