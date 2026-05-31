// Verifies the outbound write-back path without needing Google: spins a local mock
// webhook, points the writer at it, runs pushAll against live Firestore, and checks
// that every expected tab is posted with a header + data rows.
import http from 'node:http';

process.env.RUSHPOINT_SHEETS_WEBHOOK = 'http://127.0.0.1:8799/exec';

const received = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      received.push({ op: p.op, tab: p.tab, rows: (p.rows || []).length, sample: (p.rows || [])[1] });
    } catch { /* ignore */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, wrote: 1 }));
  });
});
await new Promise((r) => server.listen(8799, r));

const { db } = await import('./lib/firestore-admin.mjs');
const { pushAll } = await import('./lib/mirror-core.mjs');
await pushAll(db);
server.close();

let fail = 0;
const check = (label, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`); if (!cond) fail++; };

const byTab = Object.fromEntries(received.map((r) => [r.tab, r]));
check('all op=replaceTab', received.every((r) => r.op === 'replaceTab'));
for (const tab of ['tasks', 'basketZones', 'raceConfig', 'status']) {
  check(`posted ${tab}`, !!byTab[tab] && byTab[tab].rows >= 1, byTab[tab] ? `${byTab[tab].rows} rows; row1=${JSON.stringify(byTab[tab].sample)?.slice(0, 80)}` : 'missing');
}
console.log(`\n${fail === 0 ? 'ALL WRITE-BACK CHECKS PASSED' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
