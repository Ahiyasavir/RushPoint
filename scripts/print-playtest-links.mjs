// Print the two shareable playtest links (creator console + participant join)
// once the tunnel URL is known. Resolves the seeded access code from the running
// emulator's Firestore REST API when not supplied. (playtest-shareable-links)
//
//   node scripts/print-playtest-links.mjs <tunnelBaseUrl> [accessCode]
//
import { buildPlaytestLinks } from '@rushpoint/shared';

const PROJECT = 'rushpoint-pwa-7daaa';
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const baseUrl = process.argv[2] || process.env.PLAYTEST_BASE_URL;
if (!baseUrl) {
  console.error('Usage: node scripts/print-playtest-links.mjs <tunnelBaseUrl> [accessCode]');
  process.exit(1);
}

async function resolveSeededCode() {
  if (process.argv[3]) return process.argv[3];
  try {
    const url = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/accessCodes`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const docs = data.documents ?? [];
    if (docs.length === 0) return null;
    // Doc name tail is the access code (accessCodes/{CODE}).
    return docs[0].name.split('/').pop();
  } catch {
    return null;
  }
}

const code = await resolveSeededCode();
const { creatorUrl, joinUrl } = buildPlaytestLinks(baseUrl, code);

console.log('\n================ RushPoint playtest ================');
console.log(' Creator console (you):   ' + creatorUrl);
console.log(' Join link (testers):     ' + joinUrl);
if (!code) console.log(' (no seeded access code found — share the base link and the code from the console)');
console.log('====================================================\n');
