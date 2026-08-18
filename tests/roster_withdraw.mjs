// The correction a reviewer asked for, checked on chain.
//
// An applicant who takes back their own pending application was being recorded
// as REMOVED, which is the status a listing gets when a challenger bonds
// against it and wins. Two different things were being written down as the same
// thing, and because REMOVED is a population the list keeps a figure for while
// nothing incremented it, a single voluntary withdrawal was enough to make
// get_list_integrity report that the stored counters no longer match the
// entries.
//
// No consensus round is involved in any of this, so the run is quick and
// costs almost nothing: it is ordinary contract state, which is exactly why
// getting it wrong was worth fixing rather than explaining away.
import { Wallet } from 'file:///C:/Users/ysfym/AppData/Roaming/npm/node_modules/genlayer/node_modules/ethers/lib.esm/index.js';
import { createClient, createAccount } from '../colophon-app/node_modules/genlayer-js/dist/index.js';
import { testnetAsimov } from '../colophon-app/node_modules/genlayer-js/dist/chains/index.js';
import fs from 'fs';

const ADDR = process.env.ROSTER;
const KS = String.raw`C:\Users\ysfym\.genlayer\keystores`;
const DEPOSIT = 10n ** 15n; // 0.001 GEN, enough to be real and cheap to lose

const load = async (name, pass) => createClient({
  chain: testnetAsimov,
  account: createAccount((await Wallet.fromEncryptedJson(fs.readFileSync(`${KS}/${name}.json`, 'utf8'), pass)).privateKey),
});
const reader = createClient({ chain: testnetAsimov });

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const transient = (e) => /backpressure|not currently accepting|fetch failed|ECONNRESET|socket|timeout|Server busy|Rate limit|-32006|-32029|-32603/i
  .test(String(e?.details || e?.message || e));
async function retry(label, fn, attempts = 6) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      if (!transient(e)) throw e;
      last = e;
      console.log(`  ..  ${label}: retry ${i}/${attempts}`);
      await sleep(15 * i);
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
  try {
    const r = await retry(`receipt ${fn}`, () => client.waitForTransactionReceipt({
      hash, status: 'ACCEPTED', retries: 60, interval: 10000 }));
    console.log('  ', hash, String(r?.consensus_data?.leader_receipt?.[0]?.execution_result ?? 'accepted'));
  } catch { console.log('  ', hash, 'still settling'); }
}

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); }
};

const owner = await load('padv', 'placard-test-adv-2026');
const applicant = await load('ppub', 'placard-test-pub-2026');

console.log('roster', ADDR);

await send(owner, 'open a list', 'open_list', [
  'Maintained Rust crates',
  'Crates a team can depend on without reading the source first.',
  'The page must show a crate that has had a release in the last year, has documentation, '
  + 'and states a licence. A crate that is archived or has no releases does not belong here.',
  DEPOSIT.toString(), '600', '500',
]);

const lists = await read('get_recent_lists', ['5']);
const listId = String(lists[lists.length - 1].list_id);
console.log('   list', listId);

await send(applicant, 'apply, staking a deposit', 'apply_to_list',
  [listId, 'ripgrep', 'https://crates.io/crates/ripgrep', 'Released this year, documented, MIT and Unlicense.'],
  DEPOSIT);

const entries = await read('get_list_entries', [listId]);
const entryId = String(entries[entries.length - 1].entry_id);
console.log('   entry', entryId, 'status', entries[entries.length - 1].status);

await send(applicant, 'the applicant takes their own application back', 'withdraw_application', [entryId]);

const after = await read('get_entry', [entryId]);
console.log('\n   status is now', after.status);
check('a voluntary withdrawal is WITHDRAWN, not REMOVED',
  after.status === 'WITHDRAWN', `it was recorded as ${after.status}`);

const integrity = await read('get_list_integrity', [listId]);
console.log('   integrity', JSON.stringify(integrity));
check('the stored counters still agree with the entries',
  integrity.agrees === true, JSON.stringify(integrity));
check('and nothing was counted as removed',
  Number(integrity.stored.REMOVED) === 0 && Number(integrity.counted.REMOVED) === 0,
  JSON.stringify(integrity));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
