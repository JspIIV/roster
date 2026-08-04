# Tests

```bash
npm install genlayer-js
PROBE_ADDR=0xEF97e352EAc55D9E0AAa7Cb8aED52325D9671077 node tests/roster_parse_check.mjs
ROSTER_ADDR=0x... node tests/roster_run.mjs
```

`roster_parse_check.mjs` feeds malformed model answers to the deployed parser
probe and asserts that only a real JSON boolean becomes a verdict. They are read
calls, so it costs nothing and anyone can rerun it against the probe address.

`roster_run.mjs` drives the whole mechanism with three local keystores, so the
list owner, the applicant and the challenger are genuinely three addresses
signing their own transactions. It is resumable: every step checks the chain
first and is skipped if it already happened. Budget about fifteen minutes,
most of it waiting out a real challenge window.
