# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""A probe carrying Roster's result parser and nothing else.

The rule under test is that only a real JSON boolean becomes a verdict, and it
cannot be demonstrated through `resolve_challenge`, because that would mean
persuading live validators to answer with the wrong type on purpose. So the
parser is lifted here verbatim and exposed as a deterministic view, and the
malformed answers are fed to it directly, on chain.

Kept out of the contract itself: a method that accepts a model answer from a
caller would be a way to hand the contract a finding nobody's validators made.
"""

from genlayer import *
import json

ERROR_LLM = "[LLM_ERROR]"
VERDICT_KEEP = "KEEP"
VERDICT_STRIKE = "STRIKE"
VERDICT_UNRESOLVED = "UNRESOLVED"


class RosterParseProbe(gl.Contract):
    calls: u256

    def __init__(self) -> None:
        self.calls = u256(0)

    @gl.public.view
    def parse(self, raw: str) -> str:
        def refuse(reason: str) -> str:
            return json.dumps({
                "ok": False,
                "meets_criteria": None,
                "verdict": VERDICT_UNRESOLVED,
                "reasoning": ERROR_LLM + " " + str(reason)[:200],
            })

        raw = str(raw).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            raw = raw[start:end]
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return refuse("Non-JSON response from model")
        if not isinstance(parsed, dict):
            return refuse("Model returned " + type(parsed).__name__ + ", not an object")

        meets_criteria = parsed.get("meets_criteria", None)
        if not isinstance(meets_criteria, bool):
            return refuse(
                "meets_criteria must be a JSON boolean, got "
                + type(meets_criteria).__name__ + " " + json.dumps(meets_criteria)[:60]
            )
        verdict = VERDICT_KEEP if meets_criteria else VERDICT_STRIKE

        return json.dumps({
            "ok": True,
            "meets_criteria": meets_criteria,
            "verdict": verdict,
            "reasoning": str(parsed.get("reasoning", "")),
        })
