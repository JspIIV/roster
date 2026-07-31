# Roster

A bonded curation registry: a list whose admission criteria are written in prose, and where being wrong about a listing costs money.

Anyone opens a list and publishes the criteria for getting on it. Applicants stake a deposit to be listed. Anyone may bond against an application, or against an entry that is already listed, and a challenge is settled by GenLayer validators that fetch the applicant's cited page themselves and judge it against those criteria. The loser's stake goes to the winner, less a curation fee to the list owner.

What comes out is a maintained set that other contracts can read. That is what this contract is for.

* **Contract:** [`0x838E784536B436646e8ed47861FCE4E01dE87543`](https://explorer-studio.genlayer.com/address/0x838E784536B436646e8ed47861FCE4E01dE87543) on GenLayer Studionet
* **Source:** [`contracts/roster.py`](contracts/roster.py), 962 lines, 27 public methods

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
| `resolve_challenge` | One consensus round over the fetched page. `KEEP` means the entry belongs, `STRIKE` means it does not. |
| `finalise_entry` | After the window closes with no challenge, the entry is listed. |
| `delist_entry` | The applicant leaves the list and takes the stake back. Refused while a challenge is live. |

The kind of a challenge is decided inside the contract from the entry's current status, never taken as a parameter, so a challenger cannot pick the easier of the two paths.

### Time has to be exact

The deadline is computed once, when the application is made, and stored as an integer epoch alongside the ISO string. Later calls compare the current transaction timestamp against that stored number. Nothing recomputes a deadline from the clock at the moment it is read, because two validators would not agree on that, and the whole window would become a source of disagreement rather than a rule.

### How the decision is bound

The equivalence rule requires validators to match exactly on `verdict` and on `meets_criteria`. The rule text says what each controls: `verdict` decides which party receives the loser's staked deposit and whether the entry stands in a list that other contracts read for settlement, and `meets_criteria` is the finding the verdict is derived from, so a validator differing on it has reached a different conclusion about the page rather than worded the same one differently. Only the wording of `reasoning` may differ.

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
