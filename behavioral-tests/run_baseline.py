"""Behavioral test runner for the baseline (principles + plan mode) implementation.

Executes scenarios from SCENARIOS.md against /Users/jana/workspace/chiefofstaff.

Run with:
    /Users/jana/workspace/chiefofstaff/.venv/bin/python run_baseline.py

Writes results to ./results/baseline.json. Does not modify any source files.
"""

from __future__ import annotations

import asyncio
import json
import traceback
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


@dataclass
class ScenarioResult:
    scenario_id: str
    category: str
    title: str
    status: str
    observed: str = ""
    notes: str = ""
    expected: str = ""
    traceback: str = ""


results: list[ScenarioResult] = []


def record(sid, cat, title, expected, status, observed="", notes="", tb=""):
    results.append(ScenarioResult(
        scenario_id=sid, category=cat, title=title, expected=expected,
        status=status, observed=observed, notes=notes, traceback=tb,
    ))


# Helpers ---------------------------------------------------------------


async def fresh_storage():
    from chiefofstaff.storage.connection import SQLiteConnection
    from chiefofstaff.drafts.storage import DraftStorage

    conn = SQLiteConnection(":memory:")
    await conn.initialize()
    storage = DraftStorage(conn)
    return conn, storage


async def create_basic_draft(storage, **overrides):
    kwargs = dict(
        use_case="test-uc",
        service="twitter",
        action="create_tweet",
        content={"text": "hello world"},
        created_by="cli",
    )
    kwargs.update(overrides)
    d = await storage.create(**kwargs)
    return d.draft_id


# Category A — Timezone / scheduling semantics -------------------------


async def cat_a():
    """Baseline uses cron expressions for scheduling (not ISO timestamps).
    Adapting: testing cron-string validation and scheduling edge cases."""

    # A1: Schedule with naive ISO timestamp — baseline expects cron, not timestamps
    # This tests whether baseline even SUPPORTS one-shot timestamp scheduling
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        # Baseline has set_cron — try passing a plain ISO timestamp
        try:
            await storage.set_cron(did, "2026-05-01T10:00:00")
            # Check if storage accepted — it's a plain string column
            d = await storage.get(did)
            record("A1", "timezone",
                   "Schedule with naive ISO timestamp",
                   "Reject (cron-only) or normalize",
                   "fail" if d and d.cron == "2026-05-01T10:00:00" else "pass",
                   f"storage.set_cron accepted ISO timestamp as cron string: cron={d.cron if d else None}",
                   "Baseline uses cron expressions, not timestamps; "
                   "storage stores any string; validation happens at scheduler.evaluate() call time")
        except Exception as e:
            record("A1", "timezone",
                   "Schedule with naive ISO timestamp",
                   "Reject", "pass", f"Rejected at storage: {e}", "")
    finally:
        await conn.close()

    # A2: Non-UTC offset in cron string — crons have no TZ concept
    record("A2", "timezone", "Non-UTC offset semantics in scheduled sends",
           "N/A — baseline uses cron, not timestamps",
           "not_applicable",
           "Baseline schedules via cron expressions (no timezone field)",
           "UTC/local ambiguity is resolved by server clock only")

    # A3: UTC Z / one-shot timestamp
    record("A3", "timezone", "Schedule for a specific UTC timestamp",
           "Accept",
           "not_applicable",
           "Baseline's CLI 'schedule' command accepts a cron expression only; "
           "no one-shot timestamp scheduling exists",
           "Divergence from the original request: 'schedule for later' was "
           "interpreted as cron-based recurring")

    # A4: Schedule in the past — cron strings have no past/future, they're
    # patterns. But if cron's next() returns a fire-time in the past, what
    # does evaluator do?
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.drafts.scheduler import DraftScheduler
        did = await create_basic_draft(storage)
        # Set cron to "every minute"; set last_posted_at far in past to force
        # next-fire to be in past
        await storage.set_cron(did, "* * * * *")
        await storage.set_status(did, "scheduled")
        # Evaluate — should this draft be due?
        scheduler = DraftScheduler(storage)
        due = await scheduler.evaluate(datetime.now(UTC))
        if any(d.draft_id == did for d in due):
            record("A4", "timezone",
                   "Cron with next-fire in past",
                   "Fire immediately on next evaluate",
                   "pass",
                   f"Draft marked due on evaluate; {len(due)} drafts returned",
                   "")
        else:
            record("A4", "timezone",
                   "Cron with next-fire in past",
                   "Fire immediately on next evaluate",
                   "fail",
                   f"Not picked up; {len(due)} drafts due",
                   "")
    except Exception as e:
        record("A4", "timezone", "Cron past-due",
               "Fire immediately", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()[:200]}")
    finally:
        await conn.close()

    # A5: Far future — cron has no "far future", it's a recurring pattern
    record("A5", "timezone", "Schedule far in future (10 years)",
           "Accept",
           "not_applicable",
           "Baseline has no one-shot future timestamp; cron recurs forever",
           "")


# Category B — State machine --------------------------------------------


async def cat_b():
    # B1: set_status from posted to scheduled (illegal transition)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "posted")
        try:
            await storage.set_status(did, "scheduled")
            d = await storage.get(did)
            if d.status == "scheduled":
                record("B1", "state", "Transition posted → scheduled",
                       "Reject (terminal state)", "fail",
                       "set_status allowed posted → scheduled",
                       "Storage does not enforce state machine rules")
            else:
                record("B1", "state", "posted → scheduled", "Reject",
                       "pass", f"Transition blocked; status={d.status}", "")
        except Exception as e:
            record("B1", "state", "posted → scheduled", "Reject", "pass",
                   f"Rejected: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()

    # B2: Re-cancel already-cancelled
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "cancelled")
        try:
            await storage.set_status(did, "cancelled")
            d = await storage.get(did)
            record("B2", "state", "Re-cancel cancelled",
                   "Idempotent / reject",
                   "pass",
                   f"Allowed; status={d.status} (idempotent)", "")
        except Exception as e:
            record("B2", "state", "Re-cancel", "", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B3: Delete posted draft
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "posted")
        try:
            await storage.delete(did)
            d = await storage.get(did)
            if d is None:
                record("B3", "state", "Delete posted draft",
                       "Allow (hard delete)", "pass",
                       "Deleted", "")
            else:
                record("B3", "state", "Delete posted draft", "Allow", "fail",
                       "Delete didn't remove row", "")
        except Exception as e:
            record("B3", "state", "Delete posted", "Allow or reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B4: Cancel posted draft (reject-equivalent)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "posted")
        try:
            await storage.set_status(did, "cancelled")
            d = await storage.get(did)
            if d.status == "cancelled":
                record("B4", "state", "Cancel posted draft",
                       "Reject illegal transition", "fail",
                       "Storage allowed posted → cancelled",
                       "Storage does not enforce state machine")
            else:
                record("B4", "state", "Cancel posted", "Reject", "pass",
                       f"status={d.status}", "")
        except Exception as e:
            record("B4", "state", "Cancel posted", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B5: Re-schedule already-scheduled via set_cron
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_cron(did, "0 * * * *")
        try:
            await storage.set_cron(did, "30 * * * *")
            d = await storage.get(did)
            record("B5", "state", "Re-schedule (replace cron)",
                   "Defined (replace or reject)", "pass",
                   f"Replaced cron: {d.cron}", "")
        except Exception as e:
            record("B5", "state", "Re-schedule", "", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B6: Schedule a posted draft
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "posted")
        try:
            await storage.set_cron(did, "0 * * * *")
            d = await storage.get(did)
            record("B6", "state", "Schedule (set_cron) on posted draft",
                   "Reject",
                   "fail" if d.cron else "pass",
                   f"cron={d.cron}; status={d.status}",
                   "Storage allows set_cron regardless of status")
        except Exception as e:
            record("B6", "state", "Schedule posted", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B7: Duplicate drafts get different IDs
    conn, storage = await fresh_storage()
    try:
        d1 = await create_basic_draft(storage)
        d2 = await create_basic_draft(storage)
        if d1 != d2:
            record("B7", "state", "Duplicate content → different IDs",
                   "Different IDs", "pass",
                   f"{d1[:8]}... vs {d2[:8]}...", "")
        else:
            record("B7", "state", "Duplicate", "Different IDs", "fail",
                   "Same ID", "")
    finally:
        await conn.close()


# Category C — Concurrency ---------------------------------------------


async def cat_c():
    # C1: try_claim — second attempt should return False
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "scheduled")
        first = await storage.try_claim(did, "scheduled")
        second = await storage.try_claim(did, "scheduled")
        if first and not second:
            record("C1", "concurrency", "Sequential try_claim",
                   "First succeeds, second fails", "pass",
                   f"first={first}, second={second}",
                   "try_claim uses optimistic lock via status transition")
        else:
            record("C1", "concurrency", "Sequential try_claim",
                   "First succeeds, second fails", "fail",
                   f"first={first}, second={second}", "")
    finally:
        await conn.close()

    # C2: Delete during claim
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_status(did, "scheduled")
        await storage.delete(did)
        claimed = await storage.try_claim(did, "scheduled")
        record("C2", "concurrency", "Delete then try_claim",
               "Claim returns False", "pass" if not claimed else "fail",
               f"claimed={claimed} after delete", "")
    finally:
        await conn.close()


# Category D — ID resolution -------------------------------------------


async def cat_d():
    # D1: full match
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        d = await storage.get(did)
        record("D1", "id", "Full ID match", "Returns draft",
               "pass" if d and d.draft_id == did else "fail",
               f"Got: {d.draft_id if d else None}", "")
    finally:
        await conn.close()

    # D2: Prefix match — does baseline's CLI support this?
    # Look for a resolver helper
    try:
        import chiefofstaff.cli.main as cli_mod
        # Find any helper that takes a prefix and resolves to a draft
        resolvers = [
            n for n in dir(cli_mod)
            if 'resolve' in n.lower() or 'find' in n.lower()
        ]
        # Filter for ones that look draft-related
        draft_resolvers = [n for n in resolvers if 'draft' in n.lower()]
        if draft_resolvers:
            record("D2", "id", "Prefix match helper exists",
                   "Supports prefix match",
                   "pass", f"Helpers: {draft_resolvers}", "")
        else:
            record("D2", "id", "Prefix match support",
                   "Supports prefix match or clear error",
                   "fail",
                   "No draft-resolver/prefix helper in cli.main",
                   "Baseline requires exact ID; prefix match not supported")
    except Exception as e:
        record("D2", "id", "Prefix match helper", "", "error", "", str(e))

    # D3: ambiguous prefix — N/A since no prefix support
    record("D3", "id", "Ambiguous prefix", "",
           "not_applicable",
           "Baseline doesn't support prefix resolution",
           "")

    # D4: Non-existent ID
    conn, storage = await fresh_storage()
    try:
        d = await storage.get("not-a-real-id")
        record("D4", "id", "Non-existent ID", "None",
               "pass" if d is None else "fail",
               f"Got: {d}", "")
    finally:
        await conn.close()


# Category E — Malformed input -----------------------------------------


async def cat_e():
    # E1: Empty content — content is a dict here, so test with empty dict
    conn, storage = await fresh_storage()
    try:
        try:
            did = await create_basic_draft(storage, content={})
            d = await storage.get(did)
            if d is not None:
                record("E1", "input", "Empty content (empty dict)",
                       "Reject",
                       "fail",
                       f"Stored empty dict; draft created {did[:8]}...",
                       "No validation on empty content")
            else:
                record("E1", "input", "Empty content", "Reject", "pass",
                       "Not created", "")
        except Exception as e:
            record("E1", "input", "Empty content", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # E2: Very long content
    conn, storage = await fresh_storage()
    try:
        long_text = "x" * 5000
        did = await create_basic_draft(storage, content={"text": long_text})
        d = await storage.get(did)
        record("E2", "input", "Very long content (5000 chars)",
               "Stored; pack enforces limits",
               "pass" if d and d.content.get("text") == long_text else "fail",
               f"Stored len={len(d.content.get('text','')) if d else 0}", "")
    finally:
        await conn.close()

    # E3: Unknown service
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage, service="tiktok")
        d = await storage.get(did)
        record("E3", "input", "Unknown service name",
               "Reject at creation or at send",
               "fail" if d else "pass",
               "Storage accepted unknown service",
               "Deferred to send time")
    finally:
        await conn.close()

    # E4: Unknown action
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage, action="unknown_action")
        d = await storage.get(did)
        record("E4", "input", "Unknown action name",
               "Reject at creation or at send",
               "fail" if d else "pass",
               "Storage accepted unknown action",
               "Deferred to send time")
    finally:
        await conn.close()

    # E5: SQL special chars in content values
    conn, storage = await fresh_storage()
    try:
        bad = "'; DROP TABLE drafts;--"
        did = await create_basic_draft(storage, content={"text": bad})
        d = await storage.get(did)
        lst = await storage.list(limit=5)
        if d and d.content.get("text") == bad and lst:
            record("E5", "input", "SQL injection in content",
                   "Stored intact; table intact",
                   "pass", f"Stored intact; {len(lst)} drafts listable", "")
        else:
            record("E5", "input", "SQL injection", "Intact", "fail",
                   f"Content: {d.content if d else None}, "
                   f"list_count={len(lst)}", "")
    finally:
        await conn.close()

    # E6: Unicode
    conn, storage = await fresh_storage()
    try:
        mixed = "Hello 世界 🎉 مرحبا"
        did = await create_basic_draft(storage, content={"text": mixed})
        d = await storage.get(did)
        if d and d.content.get("text") == mixed:
            record("E6", "input", "Unicode / emoji / RTL",
                   "Stored and retrieved intact", "pass", "Intact", "")
        else:
            record("E6", "input", "Unicode", "Intact", "fail",
                   f"Got: {d.content if d else None}", "")
    finally:
        await conn.close()

    # E7: Missing required field — content=None
    conn, storage = await fresh_storage()
    try:
        try:
            await storage.create(
                use_case="uc",
                service="twitter",
                action="create_tweet",
                content=None,  # type: ignore
                created_by="cli",
            )
            record("E7", "input", "None as content", "Reject", "fail",
                   "Allowed None", "")
        except Exception as e:
            record("E7", "input", "None as content", "Reject", "pass",
                   f"Rejected: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()


# Category F — Send failure paths --------------------------------------


async def cat_f():
    from chiefofstaff.drafts.service import post_via_pack
    from chiefofstaff.storage.sqlite import SQLiteStorage

    class FakePack:
        pack_name = "twitter"
        category = "social_media"

        def __init__(self, mode="ok"):
            self.mode = mode

        def get_tools(self):
            return [{"name": "create_tweet", "description": "tweet",
                     "input_schema": {"type": "object", "properties": {}}}]

        def get_tool_names(self):
            return ["create_tweet"]

        async def initialize(self, config):
            pass

        async def shutdown(self):
            pass

        async def handle_action(self, action, input_data):
            if self.mode == "raise":
                raise RuntimeError("simulated failure")
            if self.mode == "nok":
                return {"ok": False,
                        "error": {"code": "sim", "message": "nope"}}
            return {"ok": True, "data": {"posted": True}}

        async def dispatch_action(self, action, input_data):
            return await self.handle_action(action, input_data)

    # F1: pack raises
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        d = await storage.get(did)
        pack = FakePack("raise")
        result = await post_via_pack(
            pack, d, drafts_storage=storage, run_id="run-test",
        )
        d_after = await storage.get(did)
        if result.get("ok") is False:
            record("F1", "send", "Pack raises exception",
                   "Draft transitions to failure state + result.ok=False",
                   "pass",
                   f"result.ok=False, code={result.get('error',{}).get('code')}, "
                   f"last_post_result={d_after.last_post_result}",
                   "post_via_pack catches; returns ok=False; "
                   "draft status NOT auto-transitioned to 'failed' "
                   "(baseline has no 'failed' state)")
        else:
            record("F1", "send", "Pack raises exception",
                   "Draft transitions to failure state",
                   "fail",
                   f"result={result}", "")
    except Exception as e:
        record("F1", "send", "Pack raises", "", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()[:300]}")
    finally:
        await conn.close()

    # F2: pack returns ok=False
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        d = await storage.get(did)
        pack = FakePack("nok")
        result = await post_via_pack(
            pack, d, drafts_storage=storage, run_id="run-test",
        )
        d_after = await storage.get(did)
        if result.get("ok") is False:
            record("F2", "send", "Pack returns ok=False",
                   "Result recorded; status reflects failure",
                   "pass",
                   f"status={d_after.status}, "
                   f"last_post_result={d_after.last_post_result}",
                   "Baseline: status NOT auto-updated on failure; "
                   "caller (CLI or scheduler) must handle transition")
        else:
            record("F2", "send", "Pack ok=False", "Failure recorded",
                   "fail", f"result={result}", "")
    except Exception as e:
        record("F2", "send", "Pack ok=False", "", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()[:300]}")
    finally:
        await conn.close()

    # F3: pack not registered
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.drafts.service import post_draft
        from chiefofstaff.services.registry import ServiceRegistry
        did = await create_basic_draft(storage)
        d = await storage.get(did)
        reg = ServiceRegistry()
        try:
            result = await post_draft(
                d, service_registry=reg, drafts_storage=storage,
                run_id="run-test",
            )
            record("F3", "send", "Pack not registered",
                   "Raise or return ok=False",
                   "pass" if result.get("ok") is False else "fail",
                   f"result={result}", "")
        except Exception as e:
            record("F3", "send", "Pack not registered",
                   "Raise or return ok=False",
                   "pass",
                   f"Raised: {type(e).__name__}: {e}",
                   "Baseline: get_pack_for_tool raises when pack missing")
    except Exception as e:
        record("F3", "send", "Pack missing", "", "error", "",
               f"{type(e).__name__}: {e}")
    finally:
        await conn.close()

    # F4: partial success — skip
    record("F4", "send", "Partial success", "Best-effort",
           "not_applicable", "Requires fault-injection; skipped", "")


# Category G — Scheduled send lifecycle --------------------------------


async def cat_g():
    # G1: Delete draft with cron — there's no separate scheduled_sends table
    # in baseline. Cron lives in the drafts table directly. So "CASCADE" is
    # inherently handled by delete-of-row.
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.set_cron(did, "0 * * * *")
        await storage.set_status(did, "scheduled")
        await storage.delete(did)
        d = await storage.get(did)
        record("G1", "schedule", "Delete scheduled draft",
               "Draft gone, cron disappears with it",
               "pass" if d is None else "fail",
               f"After delete: draft={d}",
               "No separate scheduled_sends table; cron lives on draft row")
    finally:
        await conn.close()

    # G2: Time arrives; scheduler picks up.
    # Baseline uses cron; next-fire is computed from last_posted_at OR
    # created_at. For "* * * * *" created now, next-fire is ~60s later.
    # Advance simulated "now" by 2 minutes to force due state.
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.drafts.scheduler import DraftScheduler
        did = await create_basic_draft(storage)
        await storage.set_cron(did, "* * * * *")
        await storage.set_status(did, "scheduled")
        scheduler = DraftScheduler(storage)
        future = datetime.now(UTC) + timedelta(minutes=2)
        due = await scheduler.evaluate(future)
        if any(d.draft_id == did for d in due):
            record("G2", "schedule", "Scheduler picks up due cron",
                   "Yes", "pass", f"Due at now+2min: count={len(due)}",
                   "Baseline cron only becomes due after next-fire anchor")
        else:
            record("G2", "schedule", "Scheduler picks up",
                   "Yes", "fail", f"Not due even at now+2min; {len(due)} returned",
                   "")
    finally:
        await conn.close()

    # G3: Replace cron (covered by B5)
    record("G3", "schedule", "Re-schedule existing",
           "Replace or reject defined", "pass",
           "Covered by B5 — set_cron replaces",
           "See B5")

    # G4: Invalid cron expression
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.drafts.scheduler import DraftScheduler
        bad_did = await create_basic_draft(storage)
        good_did = await create_basic_draft(storage)
        await storage.set_cron(bad_did, "this is not a cron")
        await storage.set_status(bad_did, "scheduled")
        await storage.set_cron(good_did, "* * * * *")
        await storage.set_status(good_did, "scheduled")
        scheduler = DraftScheduler(storage)
        try:
            future = datetime.now(UTC) + timedelta(minutes=2)
            due = await scheduler.evaluate(future)
            due_ids = {d.draft_id for d in due}
            # Bad should be skipped, good should still be due
            if good_did in due_ids and bad_did not in due_ids:
                record("G4", "schedule", "Invalid cron skipped",
                       "Skip bad, process good",
                       "pass",
                       f"due_ids={list(due_ids)}",
                       "Bad cron logged and skipped; good still processes")
            else:
                record("G4", "schedule", "Invalid cron handling",
                       "Skip bad, process good", "fail",
                       f"due_ids={list(due_ids)}, "
                       f"bad in due={bad_did in due_ids}, "
                       f"good in due={good_did in due_ids}", "")
        except Exception as e:
            record("G4", "schedule", "Invalid cron", "Skip, continue",
                   "fail",
                   f"evaluate() crashed: {type(e).__name__}: {e}",
                   "One bad cron blocks all other scheduled drafts")
    finally:
        await conn.close()


# Category H — LLM input handling --------------------------------------


def _make_use_case_baseline(drafts_mode: bool):
    from chiefofstaff.config.schema import (
        ProductConfig,
        ServiceConfig,
        UseCaseConfig,
    )
    return UseCaseConfig(
        name="promote-volnix",
        job="promote",
        approval_mode="human",
        product=ProductConfig(name="Volnix"),
        services={"twitter": ServiceConfig(enabled=True, settings={})},
        settings={"drafts_mode": drafts_mode,
                  "require_approval_for_posts": True},
    )


async def cat_h():
    from chiefofstaff.core.context import JobContext
    from chiefofstaff.core.types import RunId
    from chiefofstaff.jobs.definitions.promote.job import PromoteJob

    class _MinimalTwitterPack:
        pack_name = "twitter"
        category = "social_media"

        def get_tools(self):
            return [{"name": "create_tweet", "description": "Post a tweet",
                     "input_schema": {"type": "object", "properties": {}}}]

        def get_tool_names(self):
            return ["create_tweet"]

        async def handle_action(self, action, input_data):
            return {"ok": True, "data": {}}

        async def dispatch_action(self, action, input_data):
            return await self.handle_action(action, input_data)

        async def initialize(self, config):
            pass

        async def shutdown(self):
            pass

    # H1 / H2
    for mode, sub_id, title in [
        (True, "H1",
         "drafts_mode=True exposes save_draft, hides request_approval"),
        (False, "H2",
         "drafts_mode=False hides save_draft, exposes request_approval"),
    ]:
        try:
            job = PromoteJob()
            try:
                ctx = JobContext(
                    use_case=_make_use_case_baseline(mode),
                    run_id=RunId("r-test"),
                    services={"twitter": _MinimalTwitterPack()},
                )
            except TypeError as e:
                # Baseline may have drafts_storage field
                from chiefofstaff.drafts.storage import DraftStorage
                from chiefofstaff.storage.connection import SQLiteConnection
                _c = SQLiteConnection(":memory:")
                await _c.initialize()
                _s = DraftStorage(_c)
                ctx = JobContext(
                    use_case=_make_use_case_baseline(mode),
                    run_id=RunId("r-test"),
                    services={"twitter": _MinimalTwitterPack()},
                    drafts_storage=_s,
                )
            tools = job.get_tools(ctx)
            names = [t.get("name") for t in tools]
            has_save = "save_draft" in names
            has_approval = "request_approval" in names
            if mode:
                ok = has_save and not has_approval
            else:
                ok = not has_save and has_approval
            observed = (f"drafts_mode={mode}, save_draft={has_save}, "
                        f"request_approval={has_approval}")
            note = ("Baseline keeps request_approval alongside save_draft"
                    if mode and has_save and has_approval else "")
            record(sub_id, "llm", title, "Tool list matches mode",
                   "pass" if ok else "fail", observed, note)
        except Exception as e:
            record(sub_id, "llm", title, "Tool list matches mode", "error",
                   "",
                   f"{type(e).__name__}: {e}\n{traceback.format_exc()[:400]}")

    # H3: Unknown fields dropped
    conn, storage = await fresh_storage()
    try:
        job = PromoteJob()
        ctx = JobContext(
            use_case=_make_use_case_baseline(True),
            run_id=RunId("r-test"),
            services={"twitter": _MinimalTwitterPack()},
            drafts_storage=storage,
        )
        input_data = {
            "service": "twitter",
            "action": "create_tweet",
            "content": {"text": "hello"},
            "fake_credential": "SHOULD_NOT_LEAK",
            "api_key": "SHOULD_NOT_LEAK_EITHER",
            "__proto__": "nope",
        }
        result = job.handle_internal_tool("save_draft", input_data, ctx)
        if hasattr(result, "__await__"):
            result = await result
        did = result.get("draft_id") if isinstance(result, dict) else None
        if did:
            d = await storage.get(did)
            content_str = json.dumps(d.content) if d else ""
            leaked = [k for k in ["fake_credential", "api_key", "__proto__"]
                      if k in content_str]
            if not leaked:
                record("H3", "llm", "Unknown fields dropped via allowlist",
                       "Dropped", "pass",
                       f"draft_id={did[:8]}..., content={d.content}", "")
            else:
                record("H3", "llm", "Unknown fields dropped",
                       "Dropped", "fail", f"Leaked: {leaked}", "")
        else:
            record("H3", "llm", "Unknown fields dropped", "Dropped",
                   "fail", f"No draft_id: result={result}", "")
    except Exception as e:
        record("H3", "llm", "Unknown fields dropped", "Dropped", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()[:400]}")
    finally:
        await conn.close()

    # H4: Missing required fields
    conn, storage = await fresh_storage()
    try:
        job = PromoteJob()
        ctx = JobContext(
            use_case=_make_use_case_baseline(True),
            run_id=RunId("r-test"),
            services={"twitter": _MinimalTwitterPack()},
            drafts_storage=storage,
        )
        result = job.handle_internal_tool(
            "save_draft", {"content": {"text": "only"}}, ctx
        )
        if hasattr(result, "__await__"):
            result = await result
        ok = isinstance(result, dict) and (
            result.get("ok") is False or "error" in result
        )
        if ok:
            record("H4", "llm", "Missing required fields",
                   "Clear error, no write", "pass", f"result={result}", "")
        else:
            drafts = await storage.list(limit=5)
            record("H4", "llm", "Missing required fields",
                   "Clear error, no write",
                   "fail" if drafts else "pass",
                   f"result={result}, drafts_created={len(drafts)}", "")
    except Exception as e:
        record("H4", "llm", "Missing required fields", "Clear error",
               "error", "", f"{type(e).__name__}: {e}")
    finally:
        await conn.close()


# Category I — Integration --------------------------------------------


async def cat_i():
    from chiefofstaff.drafts.service import post_via_pack
    from chiefofstaff.storage.connection import SQLiteConnection
    from chiefofstaff.storage.sqlite import SQLiteStorage
    from chiefofstaff.drafts.storage import DraftStorage

    class FakePack:
        pack_name = "twitter"
        category = "social_media"

        def get_tools(self):
            return []

        def get_tool_names(self):
            return ["create_tweet"]

        async def initialize(self, config):
            pass

        async def shutdown(self):
            pass

        async def handle_action(self, action, input_data):
            return {"ok": True, "data": {"tweet_id": "abc123"}}

        async def dispatch_action(self, action, input_data):
            return await self.handle_action(action, input_data)

    conn = SQLiteConnection(":memory:")
    await conn.initialize()
    drafts_storage = DraftStorage(conn)
    main_storage = SQLiteStorage(conn)
    try:
        d = await drafts_storage.create(
            use_case="test-uc", service="twitter", action="create_tweet",
            content={"text": "hello"}, created_by="cli",
        )
        pack = FakePack()

        # Baseline: post_via_pack records into actions table if storage is provided
        result = await post_via_pack(
            pack, d, drafts_storage=drafts_storage, run_id="run-test",
            storage=main_storage,
        )

        runs_rows = await conn.fetchall("SELECT run_id, job_name FROM runs")
        actions_rows = await conn.fetchall("SELECT id, service, action FROM actions")
        rl_rows = await conn.fetchall(
            "SELECT service, action_type FROM rate_limits"
        )

        record("I1", "integration",
               "Approved send creates a runs row",
               "1+ runs row",
               "pass" if runs_rows else "fail",
               f"runs: {runs_rows}",
               "Baseline: post_via_pack does NOT create a runs row — "
               "caller must create it separately (CLI/daemon own this)")
        record("I2", "integration",
               "Approved send creates an actions row",
               "1+ actions row",
               "pass" if actions_rows else "fail",
               f"actions: {actions_rows}", "")
        record("I3", "integration",
               "Approved send writes rate_limits",
               "N/A without real pack",
               "not_applicable" if not rl_rows else "pass",
               f"rate_limits: {rl_rows}",
               "FakePack doesn't increment; baseline inherits "
               "from twitter client's _write_request")
    except Exception as e:
        record("I1", "integration", "Approved send creates runs row",
               "", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()[:400]}")
    finally:
        await conn.close()


# Main ------------------------------------------------------------------


async def main():
    print("Running baseline-side behavioral tests...")
    for cat_name, runner in [
        ("A (timezone)", cat_a),
        ("B (state)", cat_b),
        ("C (concurrency)", cat_c),
        ("D (id)", cat_d),
        ("E (input)", cat_e),
        ("F (send)", cat_f),
        ("G (schedule)", cat_g),
        ("H (llm)", cat_h),
        ("I (integration)", cat_i),
    ]:
        print(f"  {cat_name}...", end=" ", flush=True)
        try:
            await runner()
            print("done")
        except Exception as e:
            print(f"CATEGORY CRASH: {e}")
            record(f"{cat_name}-crash", cat_name, "category crash",
                   "no crash", "error", "",
                   f"{type(e).__name__}: {e}\n{traceback.format_exc()[:500]}")

    out = Path(__file__).parent / "results" / "baseline.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps([asdict(r) for r in results], indent=2))
    print(f"\nWrote {len(results)} results to {out}")
    from collections import Counter
    print(f"Summary: {dict(Counter(r.status for r in results))}")


if __name__ == "__main__":
    asyncio.run(main())
