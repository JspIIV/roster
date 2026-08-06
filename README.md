# Roster

A bonded curation registry: a list whose admission criteria are written in prose, and where being wrong about a listing costs money.

Anyone opens a list and publishes the criteria for getting on it. Applicants stake a deposit to be listed. Anyone may bond against an application, or against an entry that is already listed, and a challenge is settled by GenLayer validators that fetch the applicant's cited page themselves and judge it against those criteria. The loser's stake goes to the winner, less a curation fee to the list owner.

What comes out is a maintained set that other contracts can read. That is what this contract is for.

* **Contract:** [`0x69e29cccF42b504b917481DCbc369A17E7a98E50`](https://explorer-studio.genlayer.com/address/0x69e29cccF42b504b917481DCbc369A17E7a98E50) on GenLayer Studionet
* **Source:** [`contracts/roster.py`](contracts/roster.py)
* **Parser probe:** [`0xEF97e3...52325D9671077`](https://explorer-studio.genlayer.com/address/0xEF97e352EAc55D9E0AAa7Cb8aED52325D9671077), the result parser deployed on its own so its type rules can be exercised on chain

## The integration points

Two views are the reason to import this. Both expose only fields validators had to match exactly, and neither exposes an arbiter's reasoning, so nothing a downstream contract settles on can drift.

```python
get_membership(list_id, subject_url)   # is this subject on this list?
get_listed(list_id)                    # everything currently on it
```

A grant contract can require membership of a maintainers list before releasing funds. A marketplace can gate sellers on a list of verified suppliers. Neither needs to know anything about how the list is curated, and neither can be told a different answer than the one validators agreed on.

## Why this needs an intelligent contract

The criteria are prose, written at runtime by whoever opens the list. Nothing about a subject is hardcoded anywhere in the contract. Deciding whether a real page satisfies a sentence like "must show recent activity, must carry an open source licence, and must not be archived" is a judgement over a document, which is what validators can do and a deterministic contract cannot.

Making it bonded is what makes it usable. An unbonded registry is a list of claims. Here a claim costs a deposit, contesting one costs the same deposit, and being wrong costs you it. Curation pays for itself through the fee, so a list has a reason to exist beyond goodwill.

## The mechanism

| Step | What happens |
|---|---|
| `open_list` | Publishes the criteria, the deposit size, the challenge window and the curation fee. The fee is capped in a contract constant at ten percent, so an owner cannot set a confiscatory rate after people have staked. |
| `apply_to_list` | Stakes the deposit and cites a URL. The challenge window opens. |
| `challenge_entry` | Matches the deposit. Against a `PENDING` entry this is an `ADMISSION` challenge and must arrive before the window closes. Against a `LISTED` entry it is a `REMOVAL` challenge and has no deadline. |
| `resolve_challenge` | One consensus round over the fetched page. `KEEP` means the entry belongs, `STRIKE` means it does not, `UNRESOLVED` means the round produced no usable finding and nothing settles. |
| `finalise_entry` | After the window closes with no challenge, the entry is listed. |
| `delist_entry` | The applicant leaves the list and takes the stake back. Refused while a challenge is live. |

The kind of a challenge is decided inside the contract from the entry's current status, never taken as a parameter, so a challenger cannot pick the easier of the two paths.

### Time has to be exact

The deadline is computed once, when the application is made, and stored as an integer epoch alongside the ISO string. Later calls compare the current transaction timestamp against that stored number. Nothing recomputes a deadline from the clock at the moment it is read, because two validators would not agree on that, and the whole window would become a source of disagreement rather than a rule.

### How the decision is bound

The equivalence rule requires validators to match exactly on `ok`, on `verdict` and on `meets_criteria`. `ok` is whether the round produced a usable finding at all, and it decides whether any stake moves, so a validator differing on it is settling a different case. The rule text says what each controls: `verdict` decides which party receives the loser's staked deposit and whether the entry stands in a list that other contracts read for settlement, and `meets_criteria` is the finding the verdict is derived from, so a validator differing on it has reached a different conclusion about the page rather than worded the same one differently. Only the wording of `reasoning` may differ.

Actors bind to the transaction sender throughout. The owner of a list is whoever opened it, the applicant is whoever staked, the challenger is whoever bonded, and only the applicant may delist.

### Evidence is fetched, not described

Pages are retrieved with `gl.nondet.web.render(url, mode="text")`, never a raw `get`, whose opening thousands of characters are head metadata rather than the document. The fetch failure is caught **inside** the nondeterministic block and handed to the validator as readable text. A failure that escapes that block aborts the whole transaction, and an entry whose page happened to answer with a `403` would be stuck under challenge forever with both stakes locked in the contract. A page that cannot be retrieved cannot demonstrate that criteria are met, so it resolves to `meets_criteria` false rather than to nothing at all.

The fetched page is untrusted input and the prompt says so, instructing the validator to ignore any instruction inside it, including text claiming to be a system message or an override.

## Verified on chain

Run across three separate addresses: list owner `0x80519c...da6258`, applicant `0x0b5787...db9f6c`, challenger `0xbdb591...25efd2`. A list of maintained open source libraries, one GEN deposit, a 180 second window, a five percent curation fee.

**A speculative admission challenge failed.** The applicant staked on `https://github.com/psf/requests`. The challenger bonded a matching GEN, arguing the project had been archived for years.

> "The GitHub page shows the repository is active under the PSF organization with 146 open issues and 87 open pull requests, carries an Apache-2.0 license, and is not archived or marked as abandoned. The challenger's claim that it has been archived is not supported by the fetched page."

`KEEP`, `meets_criteria` true. The validator went and counted. The challenger's GEN was split: `950000000000000000` to the applicant, `50000000000000000` to the list owner as the curation fee.

**An unchallenged application was listed by time alone.** A second entry ran out its 180 seconds with nobody contesting it, and `finalise_entry` listed it. Its deposit stayed staked, which is the point: an entry with nothing behind it could not be meaningfully removed later.

**A removal challenge was brought against an entry already on the list, and also failed.** Same subject, a fresh round, a fresh bond, and the same finding. The second bond was split the same way, taking the list owner's earnings to `100000000000000000`.

**Everyone left and the contract emptied.** Both applicants called `delist_entry` and took their stakes back. `get_listed` returns `[]` and the contract's balance is `0`. Nothing is stranded, and the locked deposit model traps nobody.

Ten audit entries carry every action with its actor and timestamp.

That run was on an earlier deployment. The contract linked above is the one that came out of review, and the mechanism was re-established on it: a list opened, an admission challenge bonded and resolved, the loser's stake split `950000000000000000` to the winner and `50000000000000000` to the list owner, a second entry listed by `finalise_entry` after its window closed with nobody contesting it, then delisted by its applicant, and the contract's balance back to `0`.

The verdict came out the other way this time, and the reasoning is the reason to keep it here: the validator would not certify maintenance the fetched page did not actually show, even for a repository it recognised as real and Apache licensed. The finding follows the page, not the reputation of the subject.

## A round that decides nothing settles nothing

There are three outcomes, not two. `KEEP` and `STRIKE` move a stake. `UNRESOLVED` is what happens when the round produced no usable finding at all, and it is not a finding against anybody: the challenger's bond goes back whole, the applicant's deposit stays staked exactly where it was, the entry returns to the status it held, the list earns no curation fee, no standing moves, and anyone may challenge again.

Two things route into it, and both used to route somewhere worse.

**A finding must be a real JSON boolean.** `bool("false")` is `True` in Python, so a model answering with the string `"false"` would have been read as `true` and become `KEEP`: a deposit paid to the wrong party and an entry admitted to a set other contracts read for settlement, on a value that said the opposite. `meets_criteria` is now required to be a JSON boolean literal. Not `"true"`, not `"false"`, not `1`, not `0`. Anything else is refused rather than interpreted, because a type the contract has to guess at is not a finding.

`isinstance(True, int)` is also `True`, so the boolean check has to come before anything numeric would pass. The prompt states the rule as well, but a prompt is a request and a type check is a guarantee.

**A failure of the machinery is not a verdict either.** The fallback used to write `STRIKE` when the consensus round threw, which decided the case against the applicant because the protocol had a bad day. Pages that cannot be fetched are already handled inside the prompt through the fetch marker, so anything reaching the fallback means no finding was made, and now nothing settles on it.

The parser returns its refusal as data rather than raising. It runs inside the nondeterministic block, where the deterministic frame around it cannot catch an exception, so the fallback meant to handle a bad answer would never have run at all.

### Proving it on chain

The rule cannot be demonstrated through `resolve_challenge` without persuading live validators to answer with the wrong type on purpose. So the parser is lifted verbatim into [`contracts/roster_parse_probe.py`](contracts/roster_parse_probe.py), deployed as a deterministic view, and the malformed answers are fed to it directly on chain by [`tests/roster_parse_check.mjs`](tests/roster_parse_check.mjs).

| Model answer | Verdict |
|---|---|
| `{"meets_criteria": true}` | `KEEP` |
| `{"meets_criteria": false}` | `STRIKE` |
| `{"meets_criteria": "false"}` | `UNRESOLVED` |
| `{"meets_criteria": "true"}` | `UNRESOLVED` |
| `{"meets_criteria": 1}` and `0` | `UNRESOLVED` |
| `{"meets_criteria": null}`, or the key missing | `UNRESOLVED` |
| Not JSON, or JSON that is not an object | `UNRESOLVED` |
| A fenced code block around valid JSON | `KEEP` |

```
11 passed, 0 failed
```

The probe is deliberately a separate contract. A method on Roster itself that accepted a model answer from a caller would be a way to hand the contract a finding nobody's validators ever made.

## A second bug, and what it was really about

A reviewer found that a successful removal challenge left the entry counted as
listed. The entry itself was correct: its status was `REMOVED` and `get_listed`
no longer returned it. What was wrong was the bookkeeping beside it. The list's
own `entries_listed` counter, and the applicant's standing, both went on
claiming a membership that no longer existed.

That matters more than a wrong number. The counters exist so a caller does not
have to walk every entry, which means a caller reading `get_list` and a caller
reading `get_listed` would have been told different things about the same list,
and only one of them would have been right. A registry whose views disagree is
not a registry.

Both are now uncounted when a removal succeeds, on the list and on the record.
And because a counter that can drift once can drift again, the invariant is now
something anyone can check rather than something this contract asserts about
itself:

```python
get_list_integrity(list_id)   # walks the entries, compares them with the counters
```

It returns the counted totals, the stored totals, and whether they agree.
Proved on chain in [`tests/roster_removal.mjs`](tests/roster_removal.mjs): an
entry the criteria excluded was listed unchallenged, then removed by a bonded
challenge, and every view was read before and after.

```
before  counted {LISTED: 1}              stored {LISTED: 1}              agrees
after   counted {LISTED: 0, REMOVED: 1}  stored {LISTED: 0, REMOVED: 1}  agrees

11 passed, 0 failed
```

## A bug that testing found

The first deployment could be drained.

`finalise_entry` returned the applicant's deposit when an entry was listed unchallenged, while `_settle_challenge` assumed that deposit was still held and paid it out to a winning removal challenger. So a removal challenge won against an unchallenged listing would have paid out a deposit the contract no longer had, drawing on value staked by other entries. The same gap made removal pointless: there was nothing behind the entry to win.

The fix is that a listing keeps its deposit staked for as long as it sits in the list, and `delist_entry` exists as the clean way out. That method is refused while a challenge is live, so an entry cannot be pulled out from under a challenger who has already bonded against it. Both are in the deployment above.

## Contract API

```python
open_list(name, purpose, admission_criteria, deposit_wei,
          challenge_window_seconds, curation_fee_bps)
freeze_list(list_id)                          # owner only
apply_to_list(list_id, subject_name, subject_url, statement)   # payable
withdraw_application(entry_id)                # applicant only, while pending
challenge_entry(entry_id, argument)           # payable, matches the deposit
resolve_challenge(challenge_id)               # the consensus round, then settles
finalise_entry(entry_id)                      # after the window, unchallenged
delist_entry(entry_id)                        # applicant only, returns the stake

get_membership(list_id, subject_url)          # integration point
get_listed(list_id)                           # integration point
get_list_status / get_entry_status
get_open_window(entry_id)                     # seconds left, or 0
get_frontend_bootstrap / get_stats / get_recent_lists
get_entries_by_status / get_list_entries / get_party_entries
get_entry_challenges / get_owner_lists / get_standing
get_audit_trail(item_kind, item_id)
get_list / get_entry / get_challenge
```

## Honest limits

A list is only as good as the criteria its owner wrote and the people willing to bond against bad entries. Roster makes being wrong expensive; it cannot make anyone show up. An entry is judged against the page as it reads when a round runs, so a subject that decays quietly stays listed until somebody challenges it. And the arbiter reads text: criteria that turn on something a text renderer cannot see are not criteria it can settle.
