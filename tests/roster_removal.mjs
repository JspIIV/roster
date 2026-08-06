// Proves the transition a reviewer caught: an entry removed by a successful
// removal challenge must stop being counted as listed, everywhere.
//
// The bug was not that the entry stayed listed. It was that the entry left the
// list while the list's own counter, and the applicant's standing, went on
// claiming it. A caller reading get_listed and a caller reading get_list would
// then be told different things about the same list, and only one of them would
// be right.
//
// So the assertions here are about agreement between views, not about any one
// number: the walked count and the stored count have to match before and after.
import { Wallet } from 'file:///C:/Users/ysfym/AppData/Roaming/npm/node_modules/genlayer/node_modules/ethers/lib.esm/index.js';
import { createClient, createAccount } from '../node_modules/genlayer-js/dist/index.js';
import { studionet } from '../node_modules/genlayer-js/dist/chains/index.js';
import fs from 'fs';

const ADDR = process.env.ROSTER;
const KS = String.raw`C:\Users\ysfym\.genlayer\keystores`;
const GEN = 10n ** 18n;
const DEPOSIT = GEN;
const WINDOW = 120;

const load = async (n, p) => createClient({ chain: studionet,
  account: createAccount((await Wallet.fromEncryptedJson(fs.readFileSync(`${KS}/${n}.json`, 'utf8'), p)).privateKey) });
const reader = createClient({ chain: studionet });

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const transient = (e) => /fetch failed|ECONNRESET|socket|timeout|Unexpected token '<'|503|502|429|Rate limit|Server busy|execution slots|backpressure|not currently accepting|-32006|-32029|-32603/i
  .test(String(e?.details || e?.message || e));
async function retry(label, fn, attempts = 6) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      if (!transient(e)) throw e;
      last = e; console.log(`  ..    ${label}: retry ${i}/${attempts}`);
      await sleep(6 * i);
    }
  }
  throw last;
}
const read = async (fn, args = []) => {
  const raw = await retry(`read ${fn}`, () => reader.readContract({ address: ADDR, functionName: fn, args }));
  try { return JSON.parse(raw); } catch { return raw; }
};
async function send(client, label, fn, args, value = 0n) {
  console.log(`\n>> ${label}`);
  const hash = await retry(`send ${fn}`, () => client.writeContract({ address: ADDR, functionName: fn, args, value }));
  const r = await retry(`receipt ${fn}`, () => client.waitForTransactionReceipt({
    hash, status: 'FINALIZED', retries: 90, interval: 10000 }));
  const exec = String(r?.consensus_data?.leader_receipt?.[0]?.execution_result ?? r?.txExecutionResultName ?? '?');
  console.log('  ', hash, exec);
  return exec;
}

let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); }
};

const owner = await load('padv', 'placard-test-adv-2026');
const applicant = await load('ppub', 'placard-test-pub-2026');
const challenger = await load('pchg', 'roster-test-chg-2026');

const CRITERIA = 'The linked page must be the official project page of a software library that is '
  + 'genuinely maintained: it must show recent activity on the page itself, it must carry an open '
  + 'source licence, and it must not be archived or abandoned. A page that only describes the project '
  + 'from the outside, such as an encyclopedia article, does not qualify.';

console.log('contract', ADDR);
console.log('stats   ', JSON.stringify(await read('get_stats')));

// ---- a list with one entry on it -----------------------------------------

let stats = await read('get_stats');
if (Number(stats.lists) === 0) {
  await send(owner, 'open a list', 'open_list',
    ['Maintained libraries', 'A registry other contracts can gate on', CRITERIA,
     DEPOSIT.toString(), String(WINDOW), '500']);
}

stats = await read('get_stats');
if (Number(stats.entries) === 0) {
  // An encyclopedia article, which the criteria exclude in as many words. It is
  // listed anyway, because nobody challenges it in time, and that is the point:
  // the list can hold something that does not belong until somebody bonds
  // against it.
  await send(applicant, 'apply with a page the criteria exclude', 'apply_to_list',
    ['0', 'Static site generators', 'https://en.wikipedia.org/wiki/Static_site_generator',
     'An article about the category rather than a maintained project.'], DEPOSIT);
}

const window = await read('get_open_window', ['0']);
const left = Number(window.seconds_remaining || 0);
if (left > 0) { console.log(`\n..  waiting ${left + 5}s for the challenge window`); await sleep(left + 5); }

if ((await read('get_entry', ['0'])).status === 'PENDING') {
  await send(owner, 'finalise it, unchallenged', 'finalise_entry', ['0']);
}

console.log('\n--- before the removal challenge ---');
let integrity = await read('get_list_integrity', ['0']);
let listed = await read('get_listed', ['0']);
let standing = await read('get_standing', [applicant.account.address]);
console.log('  integrity', JSON.stringify(integrity));
console.log(`  get_listed says ${listed.length}, the applicant's standing says ${standing.entries_listed}`);
check('the counters agree with the entries before anything is removed', integrity.agrees === true,
  JSON.stringify(integrity));
check('the entry is on the list', listed.length === 1, `got ${listed.length}`);
check("and the applicant's standing counts it", Number(standing.entries_listed) === 1,
  `got ${standing.entries_listed}`);

// ---- remove it -------------------------------------------------------------

if ((await read('get_entry', ['0'])).status === 'LISTED') {
  await send(challenger, 'bond against the listed entry', 'challenge_entry',
    ['0', 'This is an encyclopedia article about a category, not a maintained project page.'], DEPOSIT);
}

const pending = await read('get_entry_challenges', ['0']);
const live = pending.find((c) => c.status === 'PENDING');
if (live) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const exec = await send(challenger, `resolve the challenge, attempt ${attempt}`,
      'resolve_challenge', [live.challenge_id]);
    if (exec.includes('ERROR')) break;
    if ((await read('get_challenge', [live.challenge_id])).status === 'RESOLVED') break;
    await sleep(20);
  }
}

const entry = await read('get_entry', ['0']);
const challenge = await read('get_challenge', [live ? live.challenge_id : '0']);
console.log(`\nthe verdict was ${challenge.verdict}: "${String(challenge.reasoning).slice(0, 150)}"`);
check('the challenge succeeded and the entry left the list', entry.status === 'REMOVED',
  `entry is ${entry.status}, verdict ${challenge.verdict}`);

// ---- and every view has to agree about that --------------------------------

console.log('\n--- after the removal ---');
integrity = await read('get_list_integrity', ['0']);
listed = await read('get_listed', ['0']);
standing = await read('get_standing', [applicant.account.address]);
const list = await read('get_list', ['0']);

console.log('  integrity', JSON.stringify(integrity));
console.log(`  get_listed says ${listed.length}, get_list says ${list.entries_listed} listed and ${list.entries_removed} removed`);
console.log(`  the applicant's standing says ${standing.entries_listed} listed, ${standing.entries_removed} removed`);

check('the walked count and the stored counters agree', integrity.agrees === true,
  JSON.stringify(integrity));
check('the list no longer counts it as listed', Number(list.entries_listed) === 0,
  `got ${list.entries_listed}`);
check('it counts it as removed instead', Number(list.entries_removed) === 1,
  `got ${list.entries_removed}`);
check('get_listed no longer returns it', listed.length === 0, `got ${listed.length}`);
check("the applicant's standing stopped claiming it", Number(standing.entries_listed) === 0,
  `got ${standing.entries_listed}`);
check("and records the removal", Number(standing.entries_removed) === 1,
  `got ${standing.entries_removed}`);

const membership = await read('get_membership',
  ['0', 'https://en.wikipedia.org/wiki/Static_site_generator']);
check('the integration point says it is not a member', membership.listed === false,
  JSON.stringify(membership));

console.log(`\n${passed} passed, ${failed} failed`);
console.log('stats', JSON.stringify(await read('get_stats')));
process.exit(failed === 0 ? 0 : 1);
