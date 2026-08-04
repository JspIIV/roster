// Feeds the malformed model answers to the deployed parser probe and asserts
// that only a real JSON boolean produces a verdict. Read calls, so this costs
// nothing and can be rerun by anyone against the probe address.
import { createClient } from '../node_modules/genlayer-js/dist/index.js';
import { studionet } from '../node_modules/genlayer-js/dist/chains/index.js';

const ADDR = process.env.PROBE_ADDR;
const reader = createClient({ chain: studionet });
const parse = async (raw) =>
  JSON.parse(await reader.readContract({ address: ADDR, functionName: 'parse', args: [raw] }));

const cases = [
  ['{"meets_criteria": true, "reasoning": "the page shows it"}', 'KEEP'],
  ['{"meets_criteria": false, "reasoning": "it does not"}', 'STRIKE'],
  ['{"meets_criteria": "false"}', 'UNRESOLVED'],
  ['{"meets_criteria": "true"}', 'UNRESOLVED'],
  ['{"meets_criteria": 1}', 'UNRESOLVED'],
  ['{"meets_criteria": 0}', 'UNRESOLVED'],
  ['{"meets_criteria": null}', 'UNRESOLVED'],
  ['{"reasoning": "no finding at all"}', 'UNRESOLVED'],
  ['the model just talked', 'UNRESOLVED'],
  ['[true]', 'UNRESOLVED'],
  ['```json\n{"meets_criteria": true}\n```', 'KEEP'],
];

let passed = 0, failed = 0;
console.log('probe', ADDR);
for (const [raw, want] of cases) {
  const got = await parse(raw);
  const ok = got.verdict === want && (want === 'UNRESOLVED' ? got.ok === false : got.ok === true);
  if (ok) { passed++; console.log(`  PASS  ${JSON.stringify(raw).slice(0, 44).padEnd(46)} ${got.verdict}`); }
  else { failed++; console.log(`  FAIL  ${JSON.stringify(raw)}\n        wanted ${want}, got ${JSON.stringify(got)}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
