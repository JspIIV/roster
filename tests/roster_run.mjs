// Drives the full Roster demo against a deployed contract.
// Three local keystores, so the list owner, the applicant and the challenger
// are genuinely three different addresses signing their own transactions.
//
// Resumable: every step checks the chain first and is skipped if already done.
import { Wallet } from 'file:///C:/Users/ysfym/AppData/Roaming/npm/node_modules/genlayer/node_modules/ethers/lib.esm/index.js';
import { createClient, createAccount } from '../node_modules/genlayer-js/dist/index.js';
import { studionet } from '../node_modules/genlayer-js/dist/chains/index.js';
import fs from 'fs';

const ADDR = process.env.ROSTER_ADDR;
const KS = String.raw`C:\Users\ysfym\.genlayer\keystores`;
const GEN = 10n ** 18n;

async function load(name, password) {
  const w = await Wallet.fromEncryptedJson(fs.readFileSync(`${KS}/${name}.json`, 'utf8'), password);
  return createClient({ chain: studionet, account: createAccount(w.privateKey) });
}

const reader = createClient({ chain: studionet });

async function read(fn, args = []) {
  const raw = await reader.readContract({ address: ADDR, functionName: fn, args });
  try { return JSON.parse(raw); } catch { return raw; }
}

async function send(client, label, fn, args, value = 0n) {
  console.log(`\n>> ${label}`);
  const hash = await client.writeContract({ address: ADDR, functionName: fn, args, value });
  const r = await client.waitForTransactionReceipt({ hash, status: 'FINALIZED', retries: 60, interval: 15000 });
  const exec = r?.consensus_data?.leader_receipt?.[0]?.execution_result ?? r?.execution_result ?? '?';
  console.log(`   ${hash}  ${exec}`);
  return r;
}

const owner = await load('padv', 'placard-test-adv-2026');
const applicant = await load('ppub', 'placard-test-pub-2026');
const challenger = await load('pchg', 'roster-test-chg-2026');

const CRITERIA = 'The linked page must be the official project page of a software library that is genuinely maintained: it must show recent activity, it must carry an open source licence, and it must not be archived or abandoned. A page that only describes the project from the outside, such as an encyclopedia article, does not qualify.';

let s = await read('get_stats');
console.log('stats on entry', JSON.stringify(s));

// 1. the owner opens a list
if (s.lists === 0) {
  await send(owner, 'open_list', 'open_list', [
    'Maintained Open Source Libraries',
    'A registry other contracts can gate perks or funding on, listing libraries that are actually still maintained',
    CRITERIA,
    (1n * GEN).toString(),
    '180',
    '500',
  ]);
  s = await read('get_stats');
} else console.log('skip open_list');
const lid = String(s.lists - 1);

// 2. a genuine applicant stakes a deposit
if (s.entries === 0) {
  await send(applicant, 'apply_to_list, entry #0', 'apply_to_list', [
    lid,
    'Requests',
    'https://github.com/psf/requests',
    'The official repository for the Requests HTTP library, Apache licensed and still receiving commits.',
  ], 1n * GEN);
  s = await read('get_stats');
} else console.log('skip apply #0');

// 3. a third party bonds a challenge against it
if (s.challenges === 0 && (await read('get_entry', ['0'])).status === 'PENDING') {
  await send(challenger, 'challenge_entry #0, speculative attack', 'challenge_entry', [
    '0',
    'This project has been archived for years and no longer accepts contributions, so it does not meet the maintenance bar for this list.',
  ], 1n * GEN);
}

// 4. the round, then the three way split
if ((await read('get_challenge', ['0'])).status === 'PENDING') {
  await send(challenger, 'resolve_challenge #0', 'resolve_challenge', ['0']);
}
console.log('\nchallenge 0:', JSON.stringify(await read('get_challenge', ['0']), null, 1));
console.log('entry 0:    ', JSON.stringify(await read('get_entry', ['0'])));

// 5. a second application that nobody contests
s = await read('get_stats');
if (s.entries < 2) {
  await send(applicant, 'apply_to_list, entry #1', 'apply_to_list', [
    lid,
    'Flask',
    'https://github.com/pallets/flask',
    'The official repository for the Flask web framework, BSD licensed and actively maintained.',
  ], 1n * GEN);
}

const win = await read('get_open_window', ['1']);
console.log('\nwindow left on entry 1:', JSON.stringify(win));
const wait = (Number(win.seconds_remaining ?? win.remaining ?? 0) + 10) * 1000;
if (wait > 0 && (await read('get_entry', ['1'])).status === 'PENDING') {
  console.log(`waiting ${Math.round(wait / 1000)}s for the challenge window to close`);
  await new Promise(r => setTimeout(r, wait));
}
if ((await read('get_entry', ['1'])).status === 'PENDING') {
  await send(owner, 'finalise_entry #1, unchallenged', 'finalise_entry', ['1']);
}

console.log('\n=== the composition surface ===');
console.log('membership requests ', JSON.stringify(await read('get_membership', [lid, 'https://github.com/psf/requests'])));
console.log('membership flask    ', JSON.stringify(await read('get_membership', [lid, 'https://github.com/pallets/flask'])));
console.log('membership unlisted ', JSON.stringify(await read('get_membership', [lid, 'https://example.com/nothing'])));
console.log('listed              ', JSON.stringify(await read('get_listed', [lid])));

console.log('\n=== final ===');
console.log('list   ', JSON.stringify(await read('get_list', [lid])));
console.log('entry 1', JSON.stringify(await read('get_entry', ['1'])));
console.log('stats  ', JSON.stringify(await read('get_stats')));

// 6. a removal challenge against an entry that is already listed
s = await read('get_stats');
if (s.challenges < 2 && (await read('get_entry', ['0'])).status === 'LISTED') {
  await send(challenger, 'challenge_entry #0 again, this time a REMOVAL', 'challenge_entry', [
    '0',
    'Whatever this looked like when it was admitted, the project is now unmaintained and should not keep its place on the list.',
  ], 1n * GEN);
}
if ((await read('get_challenge', ['1'])).status === 'PENDING') {
  await send(challenger, 'resolve_challenge #1', 'resolve_challenge', ['1']);
}
console.log('\nchallenge 1 (removal):', JSON.stringify(await read('get_challenge', ['1']), null, 1));

// 7. the applicant leaves the list voluntarily and takes the stake back
for (const id of ['0', '1']) {
  if ((await read('get_entry', [id])).status === 'LISTED') {
    await send(applicant, `delist_entry #${id}`, 'delist_entry', [id]);
  }
}

console.log('\n=== after everyone has left ===');
console.log('entry 0', JSON.stringify(await read('get_entry', ['0'])));
console.log('entry 1', JSON.stringify(await read('get_entry', ['1'])));
console.log('listed ', JSON.stringify(await read('get_listed', [lid])));
console.log('list   ', JSON.stringify(await read('get_list', [lid])));
console.log('stats  ', JSON.stringify(await read('get_stats')));
