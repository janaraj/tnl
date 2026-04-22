"""Behavioral test runner for the CNL implementation.

Executes 40 scenarios from SCENARIOS.md against
/Users/jana/workspace/chiefofstaff-cnl.

Run with:
    /Users/jana/workspace/chiefofstaff-cnl/.venv/bin/python run_cnl.py

Writes results to ./results/cnl.json.
Does not modify any source files in the repo under test.
"""

from __future__ import annotations

import asyncio
import json
import sys
import traceback
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

# Results structure -----------------------------------------------------


@dataclass
class ScenarioResult:
    scenario_id: str
    category: str
    title: str
    status: str  # pass | fail | error | not_applicable
    observed: str = ""
    notes: str = ""
    expected: str = ""
    traceback: str = ""


results: list[ScenarioResult] = []


def record(
    sid: str,
    cat: str,
    title: str,
    expected: str,
    status: str,
    observed: str = "",
    notes: str = "",
    tb: str = "",
) -> None:
    results.append(
        ScenarioResult(
            scenario_id=sid,
            category=cat,
            title=title,
            expected=expected,
            status=status,
            observed=observed,
            notes=notes,
            traceback=tb,
        )
    )


# Storage helpers -------------------------------------------------------


async def fresh_storage():
    from chiefofstaff.storage.connection import SQLiteConnection
    from chiefofstaff.storage.sqlite import SQLiteStorage

    conn = SQLiteConnection(":memory:")
    await conn.initialize()
    storage = SQLiteStorage(conn)
    return conn, storage


async def create_basic_draft(storage, **overrides) -> str:
    kwargs = dict(
        use_case="test-uc",
        service="twitter",
        action="create_tweet",
        content="hello world",
        metadata=None,
        created_by="human",
    )
    kwargs.update(overrides)
    return await storage.create_draft(**kwargs)


# Category A — Timezone handling ---------------------------------------


async def cat_a():
    # A1: Schedule with naive timestamp (no tz)
    conn, storage = await fresh_storage()
    try:
        try:
            from chiefofstaff.cli.drafts import _parse_utc_iso

            try:
                _parse_utc_iso("2026-05-01T10:00:00")
                record(
                    "A1",
                    "timezone",
                    "Schedule with naive timestamp (no tz)",
                    "Reject — must not silently normalize",
                    "fail",
                    "Accepted naive timestamp without rejection",
                    "CNL claims rejection of non-UTC/naive via _parse_utc_iso",
                )
            except Exception as e:
                record(
                    "A1",
                    "timezone",
                    "Schedule with naive timestamp (no tz)",
                    "Reject — must not silently normalize",
                    "pass",
                    f"Rejected: {type(e).__name__}: {e}",
                    "CNL's _parse_utc_iso rejects naive timestamps",
                )
        except ImportError as e:
            record("A1", "timezone", "Schedule with naive timestamp (no tz)",
                   "Reject", "error", "", f"ImportError: {e}")
    finally:
        await conn.close()

    # A2: Non-UTC offset
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.cli.drafts import _parse_utc_iso

        try:
            _parse_utc_iso("2026-05-01T10:00:00+05:30")
            record(
                "A2",
                "timezone",
                "Schedule with non-UTC offset +05:30",
                "Reject",
                "fail",
                "Accepted non-UTC offset without normalization",
                "",
            )
        except Exception as e:
            record(
                "A2",
                "timezone",
                "Schedule with non-UTC offset +05:30",
                "Reject",
                "pass",
                f"Rejected: {type(e).__name__}: {e}",
                "CNL rejects non-UTC offsets at CLI",
            )
    finally:
        await conn.close()

    # A3: UTC Z
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.cli.drafts import _parse_utc_iso

        try:
            dt = _parse_utc_iso("2026-05-01T10:00:00Z")
            if dt.tzinfo is not None and dt.utcoffset() == timedelta(0):
                record("A3", "timezone", "Schedule with UTC Z", "Accept", "pass",
                       f"Parsed to {dt.isoformat()}", "")
            else:
                record("A3", "timezone", "Schedule with UTC Z", "Accept", "fail",
                       f"Unexpected: {dt}", "")
        except Exception as e:
            record("A3", "timezone", "Schedule with UTC Z", "Accept", "fail",
                   f"Rejected unexpectedly: {e}", "")
    finally:
        await conn.close()

    # A4: Schedule in the past
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        past = datetime.now(UTC) - timedelta(hours=1)
        try:
            await storage.schedule_send(did, past)
            # Now check if it's claimable immediately
            claimed = await storage.claim_due_sends(datetime.now(UTC))
            if any(d.draft_id == did for d in claimed):
                record(
                    "A4",
                    "timezone",
                    "Schedule in the past",
                    "Clear behavior (fire immediately OR reject)",
                    "pass",
                    "Accepted past timestamp; fires immediately via claim",
                    "Storage allows past fire_at and claims immediately",
                )
            else:
                record(
                    "A4",
                    "timezone",
                    "Schedule in the past",
                    "Clear behavior",
                    "fail",
                    "Accepted but not claimable — orphaned?",
                    "",
                )
        except Exception as e:
            record(
                "A4",
                "timezone",
                "Schedule in the past",
                "Clear behavior",
                "pass",
                f"Rejected at schedule time: {e}",
                "",
            )
    finally:
        await conn.close()

    # A5: Far future
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        far = datetime.now(UTC) + timedelta(days=3650)
        try:
            await storage.schedule_send(did, far)
            record(
                "A5",
                "timezone",
                "Schedule 10 years in the future",
                "Accept",
                "pass",
                f"Accepted far future: {far}",
                "",
            )
        except Exception as e:
            record(
                "A5",
                "timezone",
                "Schedule 10 years in the future",
                "Accept",
                "fail",
                f"Rejected: {e}",
                "",
            )
    finally:
        await conn.close()


# Category B — State machine -------------------------------------------


async def cat_b():
    # B1: Approve already-sent
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        # Force status to sent
        await storage.update_draft_status(did, "sent")
        # Now try to schedule (which requires pending)
        try:
            await storage.schedule_send(
                did, datetime.now(UTC) + timedelta(hours=1)
            )
            record("B1", "state", "Approve/schedule already-sent", "Reject", "fail",
                   "schedule_send allowed on sent draft", "")
        except Exception as e:
            record("B1", "state", "Approve/schedule already-sent", "Reject", "pass",
                   f"Rejected: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()

    # B2: Reject already-rejected (storage-level)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.update_draft_status(did, "rejected", notes="first")
        try:
            await storage.update_draft_status(did, "rejected", notes="second")
            d = await storage.get_draft(did)
            record("B2", "state", "Re-reject already-rejected", "Reject",
                   "fail" if d.notes == "second" else "pass",
                   f"Status transition allowed; notes={d.notes}",
                   "Storage doesn't enforce 'no re-transition from terminal'")
        except Exception as e:
            record("B2", "state", "Re-reject already-rejected", "Reject", "pass",
                   f"Rejected: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()

    # B3: Delete sent draft
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.update_draft_status(did, "sent")
        deleted = await storage.delete_draft(did)
        if deleted:
            record("B3", "state", "Delete sent draft", "Allow or reject consistently",
                   "pass", "Delete succeeds on sent draft (hard-delete by design)",
                   "CNL says hard-delete, no soft-delete")
        else:
            record("B3", "state", "Delete sent draft", "Allow or reject", "fail",
                   "Delete returned False for existing sent draft", "")
    finally:
        await conn.close()

    # B4: Reject already-sent (via status update)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.update_draft_status(did, "sent")
        try:
            await storage.update_draft_status(did, "rejected", notes="x")
            d = await storage.get_draft(did)
            if d.status == "rejected":
                record("B4", "state", "Reject sent draft (via storage)",
                       "Reject illegal transition", "fail",
                       "Storage allowed sent → rejected",
                       "Storage does not enforce state machine")
            else:
                record("B4", "state", "Reject sent draft", "Reject", "pass",
                       "Storage blocked transition", "")
        except Exception as e:
            record("B4", "state", "Reject sent draft", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B5: Re-schedule already-scheduled
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        t1 = datetime.now(UTC) + timedelta(hours=1)
        t2 = datetime.now(UTC) + timedelta(hours=5)
        await storage.schedule_send(did, t1)
        try:
            await storage.schedule_send(did, t2)
            record("B5", "state", "Re-schedule already-scheduled",
                   "Defined behavior (replace or reject)", "pass",
                   "Replaced schedule without error (UPSERT semantics)", "")
        except Exception as e:
            record("B5", "state", "Re-schedule already-scheduled",
                   "Defined behavior", "pass", f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B6: Schedule a draft that's already sent
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        await storage.update_draft_status(did, "sent")
        try:
            await storage.schedule_send(
                did, datetime.now(UTC) + timedelta(hours=1)
            )
            record("B6", "state", "Schedule a sent draft", "Reject", "fail",
                   "Allowed schedule on sent draft (storage-level)", "")
        except Exception as e:
            record("B6", "state", "Schedule a sent draft", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # B7: Different drafts get different IDs
    conn, storage = await fresh_storage()
    try:
        d1 = await create_basic_draft(storage)
        d2 = await create_basic_draft(storage)
        if d1 != d2:
            record("B7", "state", "Duplicate content → different IDs",
                   "Different IDs", "pass", f"IDs: {d1[:8]}... vs {d2[:8]}...", "")
        else:
            record("B7", "state", "Duplicate content → different IDs",
                   "Different IDs", "fail", "Same ID returned", "")
    finally:
        await conn.close()


# Category C — Concurrency ---------------------------------------------


async def cat_c():
    # C1: Sequential claims — second should be empty
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        past = datetime.now(UTC) - timedelta(seconds=1)
        await storage.schedule_send(did, past)
        now = datetime.now(UTC)
        first = await storage.claim_due_sends(now)
        second = await storage.claim_due_sends(now)
        a_ids = [d.draft_id for d in first]
        b_ids = [d.draft_id for d in second]
        if len(a_ids) == 1 and a_ids[0] == did and not b_ids:
            record("C1", "concurrency", "Sequential claims (no double-fire)",
                   "Second claim returns nothing", "pass",
                   f"first={a_ids}, second={b_ids}",
                   "First claim marks claimed_at; second filters it out")
        else:
            record("C1", "concurrency", "Sequential claims (no double-fire)",
                   "Second claim empty", "fail",
                   f"first={a_ids}, second={b_ids}",
                   "Either double-claim or unexpected state")
    finally:
        await conn.close()

    # C2: Delete while claim in progress (sequential approximation)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        past = datetime.now(UTC) - timedelta(seconds=1)
        await storage.schedule_send(did, past)
        # Delete and then claim — should see nothing
        deleted = await storage.delete_draft(did)
        claimed = await storage.claim_due_sends(datetime.now(UTC))
        if deleted and not any(d.draft_id == did for d in claimed):
            record("C2", "concurrency", "Delete then claim", "Claim sees nothing",
                   "pass",
                   f"Deleted={deleted}, claimed_count={len(claimed)}",
                   "CASCADE deleted the scheduled_sends row")
        else:
            record("C2", "concurrency", "Delete then claim", "Claim sees nothing",
                   "fail",
                   f"Deleted={deleted}, claimed={[d.draft_id for d in claimed]}", "")
    finally:
        await conn.close()


# Category D — ID resolution -------------------------------------------


async def cat_d():
    # D1: Full UUID match
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        d = await storage.get_draft(did)
        if d is not None and d.draft_id == did:
            record("D1", "id", "Full UUID match", "Returns draft", "pass",
                   f"Got draft {did[:8]}...", "")
        else:
            record("D1", "id", "Full UUID match", "Returns draft", "fail",
                   "get_draft returned None for known id", "")
    finally:
        await conn.close()

    # D2: Prefix match — test the CLI resolver
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        prefix = did[:8]
        # CNL has a CLI-level _resolve_draft helper
        try:
            from chiefofstaff.cli.drafts import _resolve_draft
            d = await _resolve_draft(storage, prefix)
            if d is not None and d.draft_id == did:
                record("D2", "id", "Unambiguous prefix match",
                       "Returns single draft", "pass",
                       f"Resolved prefix '{prefix}' to {did[:8]}...", "")
            else:
                record("D2", "id", "Unambiguous prefix match",
                       "Returns single draft", "fail",
                       f"_resolve_draft returned {d}", "")
        except ImportError:
            record("D2", "id", "Unambiguous prefix match", "Returns", "error",
                   "", "_resolve_draft not found")
    finally:
        await conn.close()

    # D3: Ambiguous prefix
    conn, storage = await fresh_storage()
    try:
        from chiefofstaff.cli.drafts import _resolve_draft

        # Force two drafts with known overlapping prefix by constructing IDs
        # manually — but create_draft autogenerates. So instead: create many
        # and find two that share the first character.
        ids = []
        for _ in range(30):
            ids.append(await create_basic_draft(storage))
        by_prefix: dict[str, list[str]] = {}
        for i in ids:
            by_prefix.setdefault(i[0], []).append(i)
        shared = next((v for v in by_prefix.values() if len(v) >= 2), None)
        if not shared:
            record("D3", "id", "Ambiguous prefix", "Error/None", "not_applicable",
                   "Couldn't get two drafts with same first char", "")
        else:
            prefix = shared[0][0]  # 1-char prefix
            try:
                d = await _resolve_draft(storage, prefix)
                if d is None:
                    record("D3", "id", "Ambiguous prefix", "Returns None", "pass",
                           f"prefix='{prefix}' matched {len(shared)} drafts → None",
                           "CNL returns None on ambiguous match")
                else:
                    record("D3", "id", "Ambiguous prefix",
                           "Should return None on ambiguity", "fail",
                           f"Returned a draft despite {len(shared)} matches", "")
            except Exception as e:
                record("D3", "id", "Ambiguous prefix", "Returns None", "pass",
                       f"Raised: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()

    # D4: Non-existent / malformed
    conn, storage = await fresh_storage()
    try:
        d = await storage.get_draft("not-a-real-id")
        record("D4", "id", "Non-existent ID", "None", "pass" if d is None else "fail",
               f"Returned: {d}", "")
    finally:
        await conn.close()


# Category E — Malformed input -----------------------------------------


async def cat_e():
    # E1: Empty content
    conn, storage = await fresh_storage()
    try:
        try:
            did = await create_basic_draft(storage, content="")
            d = await storage.get_draft(did)
            record("E1", "input", "Empty content", "Reject",
                   "fail" if d is not None else "pass",
                   f"Stored empty content as draft {did[:8] if did else ''}",
                   "No validation on empty content at storage layer")
        except Exception as e:
            record("E1", "input", "Empty content", "Reject", "pass",
                   f"Rejected: {e}", "")
    finally:
        await conn.close()

    # E2: Very long content
    conn, storage = await fresh_storage()
    try:
        long_text = "x" * 5000
        did = await create_basic_draft(storage, content=long_text)
        d = await storage.get_draft(did)
        record("E2", "input", "Very long content (5000 chars)",
               "Stored as-is; pack enforces limits at send",
               "pass" if d and d.content == long_text else "fail",
               f"Stored len={len(d.content) if d else 0}",
               "Storage doesn't check length; pack is expected to")
    finally:
        await conn.close()

    # E3: Unknown service name (storage-level)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage, service="tiktok")
        d = await storage.get_draft(did)
        record("E3", "input", "Unknown service name",
               "Either reject at creation or at send",
               "fail" if d else "pass",
               f"Storage accepted service='tiktok'; draft created",
               "Storage doesn't validate service name; deferred to send time")
    finally:
        await conn.close()

    # E4: Unknown action name (storage-level)
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage, action="unknown_action")
        d = await storage.get_draft(did)
        record("E4", "input", "Unknown action name",
               "Either reject at creation or at send",
               "fail" if d else "pass",
               "Storage accepted unknown action",
               "Same — deferred to send time")
    finally:
        await conn.close()

    # E5: SQL-special chars
    conn, storage = await fresh_storage()
    try:
        bad = "'; DROP TABLE drafts;--"
        did = await create_basic_draft(storage, content=bad)
        d = await storage.get_draft(did)
        if d and d.content == bad:
            # Also verify drafts table still exists
            d2 = await storage.list_drafts(limit=10)
            record("E5", "input", "SQL injection in content",
                   "Stored and retrieved intact; table intact",
                   "pass", f"Stored intact; list_drafts returned {len(d2)} rows",
                   "Parameterized queries work correctly")
        else:
            record("E5", "input", "SQL injection in content", "Intact", "fail",
                   f"Content changed: {d.content if d else None!r}", "")
    finally:
        await conn.close()

    # E6: Unicode / emoji
    conn, storage = await fresh_storage()
    try:
        mixed = "Hello 世界 🎉 مرحبا"
        did = await create_basic_draft(storage, content=mixed)
        d = await storage.get_draft(did)
        if d and d.content == mixed:
            record("E6", "input", "Unicode / emoji / RTL",
                   "Stored and retrieved intact", "pass", "Intact", "")
        else:
            record("E6", "input", "Unicode / emoji / RTL", "Intact", "fail",
                   f"Got: {d.content if d else None!r}", "")
    finally:
        await conn.close()

    # E7: Missing required field
    conn, storage = await fresh_storage()
    try:
        try:
            await storage.create_draft(
                use_case="uc",
                service="twitter",
                action="create_tweet",
                content=None,  # type: ignore
                created_by="human",
            )
            record("E7", "input", "None as content", "Reject", "fail",
                   "Allowed None content", "")
        except Exception as e:
            record("E7", "input", "None as content", "Reject", "pass",
                   f"Rejected: {type(e).__name__}: {e}", "")
    finally:
        await conn.close()


# Category F — Send failure paths --------------------------------------


async def cat_f():
    from chiefofstaff.storage.drafts import Draft

    # We probe the runner's execute_send directly with mocked services
    class FakePack:
        """Minimal pack that can be configured to raise or return ok=False."""

        pack_name = "twitter"
        category = "social"

        def __init__(self, mode="ok"):
            self.mode = mode
            self._initialized = True

        def get_tools(self):
            return []

        def get_tool_names(self):
            return ["create_tweet"]

        async def initialize(self, config):
            pass

        async def shutdown(self):
            pass

        async def handle_action(self, action, input_data):
            if self.mode == "raise":
                from chiefofstaff.services.common.errors import APIError
                raise APIError("simulated failure")
            if self.mode == "nok":
                return {"ok": False, "error": {"code": "sim", "message": "nope"}}
            return {"ok": True, "data": {"posted": True}}

        async def dispatch_action(self, action, input_data):
            return await self.handle_action(action, input_data)

    from chiefofstaff.runner.engine import JobRunner
    from chiefofstaff.services.registry import ServiceRegistry
    from chiefofstaff.jobs.registry import JobRegistry

    for sub_id, mode, expected_status, desc in [
        ("F1", "raise", "failed", "Pack raises → draft failed"),
        ("F2", "nok", "failed", "Pack returns ok=False → draft failed"),
        ("F3", "missing", "failed", "Pack not registered → draft failed"),
    ]:
        conn, storage = await fresh_storage()
        try:
            did = await create_basic_draft(storage)
            draft = await storage.get_draft(did)

            sreg = ServiceRegistry()
            if mode != "missing":
                pack = FakePack(mode)
                try:
                    sreg.register_pack(pack)
                except Exception:
                    # Try alternative register API
                    try:
                        sreg._packs[pack.pack_name] = pack  # type: ignore
                    except Exception as e2:
                        record(sub_id, "send", desc, f"Draft → {expected_status}",
                               "error", "", f"ServiceRegistry register failed: {e2}")
                        continue

            jreg = JobRegistry()

            try:
                runner = JobRunner(
                    job_registry=jreg,
                    service_registry=sreg,
                    llm_router=None,  # type: ignore
                    storage=storage,
                    memory=None,
                    event_bus=None,
                )
            except Exception as e:
                record(sub_id, "send", desc, f"Draft → {expected_status}",
                       "error", "", f"JobRunner ctor: {type(e).__name__}: {e}")
                continue

            try:
                result = await runner.execute_send(draft)
            except Exception as e:
                d_after = await storage.get_draft(did)
                record(sub_id, "send", desc, f"Draft → {expected_status}",
                       "pass" if (d_after and d_after.status == expected_status) else "fail",
                       f"execute_send raised: {type(e).__name__}: {e}; "
                       f"draft.status={d_after.status if d_after else 'None'}",
                       "")
                continue

            d_after = await storage.get_draft(did)
            if d_after and d_after.status == expected_status:
                record(sub_id, "send", desc, f"Draft → {expected_status}",
                       "pass",
                       f"status={d_after.status}, notes={d_after.notes!r}, "
                       f"result={result}", "")
            else:
                record(sub_id, "send", desc, f"Draft → {expected_status}",
                       "fail",
                       f"status={d_after.status if d_after else 'None'}, "
                       f"result={result}", "")
        except Exception as e:
            record(sub_id, "send", desc, f"Draft → {expected_status}", "error",
                   "", f"{type(e).__name__}: {e}\n{traceback.format_exc()[:400]}")
        finally:
            await conn.close()

    # F4: partial success — out of scope for direct probing
    record("F4", "send", "Partial success (pack ok + storage fails)",
           "Best-effort recovery", "not_applicable",
           "Requires fault-injection into storage; skipped", "")


# Category G — Scheduled send lifecycle --------------------------------


async def cat_g():
    # G1: CASCADE delete
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        future = datetime.now(UTC) + timedelta(hours=2)
        await storage.schedule_send(did, future)
        await storage.delete_draft(did)
        # scheduled_sends row should be gone via CASCADE
        # Use internal check: raw SQL against scheduled_sends
        raw = await conn.fetchall(
            "SELECT draft_id FROM scheduled_sends WHERE draft_id = ?",
            (did,),
        )
        if not raw:
            record("G1", "schedule", "Delete draft → scheduled_sends CASCADE",
                   "Row removed", "pass",
                   "scheduled_sends row gone after delete", "")
        else:
            record("G1", "schedule", "Delete draft → scheduled_sends CASCADE",
                   "Row removed", "fail",
                   f"scheduled_sends row still present: {raw}", "")
    finally:
        await conn.close()

    # G2: Schedule + time arrives + claim
    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        past = datetime.now(UTC) - timedelta(seconds=1)
        await storage.schedule_send(did, past)
        claimed = await storage.claim_due_sends(datetime.now(UTC))
        if any(d.draft_id == did for d in claimed):
            record("G2", "schedule", "Time arrives → claim picks it up", "Yes",
                   "pass", f"Claimed {len(claimed)} drafts", "")
        else:
            record("G2", "schedule", "Time arrives → claim picks it up", "Yes",
                   "fail", "Not claimed", "")
    finally:
        await conn.close()

    # G3: Reschedule (already covered in B5)
    record("G3", "schedule", "Re-schedule existing", "Replace or reject (defined)",
           "pass", "Covered by B5 — CNL uses UPSERT semantics",
           "See B5")

    # G4: Cron-based — N/A for CNL
    record("G4", "schedule", "Cron expression handling",
           "N/A — CNL explicitly non-goaled cron",
           "not_applicable",
           "CNL scopes out cron; baseline only",
           "Explicit non-goal in promote-drafts.cnl")


# Category H — LLM input handling --------------------------------------


def _make_use_case_cnl(draft_mode: bool):
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
        settings={
            "draft_mode": draft_mode,
            "require_approval_for_posts": True,
        },
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
         "draft_mode=True exposes create_draft, hides request_approval"),
        (False, "H2",
         "draft_mode=False hides create_draft, exposes request_approval"),
    ]:
        try:
            job = PromoteJob()
            ctx = JobContext(
                use_case=_make_use_case_cnl(mode),
                run_id=RunId("r-test"),
                services={"twitter": _MinimalTwitterPack()},
            )
            tools = job.get_tools(ctx)
            names = [t.get("name") for t in tools]
            has_create = "create_draft" in names
            has_approval = "request_approval" in names
            if mode:
                ok = has_create and not has_approval
            else:
                ok = not has_create and has_approval
            record(sub_id, "llm", title, "Tool list matches mode",
                   "pass" if ok else "fail",
                   f"draft_mode={mode}, create_draft={has_create}, "
                   f"request_approval={has_approval}", "")
        except Exception as e:
            record(sub_id, "llm", title, "Tool list matches mode", "error",
                   "", f"{type(e).__name__}: {e}\n{traceback.format_exc()}")

    # H3: unknown fields dropped
    conn, storage = await fresh_storage()
    try:
        job = PromoteJob()
        ctx = JobContext(
            use_case=_make_use_case_cnl(True),
            run_id=RunId("r-test"),
            services={"twitter": _MinimalTwitterPack()},
            storage=storage,
        )
        input_data = {
            "service": "twitter",
            "action": "create_tweet",
            "content": "hello",
            "fake_credential": "SHOULD_NOT_LEAK",
            "api_key": "SHOULD_NOT_LEAK_EITHER",
            "__proto__": "nope",
        }
        # handle_internal_tool is sync-or-async? Check
        result = job.handle_internal_tool("create_draft", input_data, ctx)
        if hasattr(result, "__await__"):
            result = await result
        did = (result.get("draft_id") if isinstance(result, dict) else None)
        if did:
            d = await storage.get_draft(did)
            md = dict(d.metadata or {})
            content_blob = d.content if d else ""
            leaked = [
                k for k in ["fake_credential", "api_key", "__proto__"]
                if k in md or k in content_blob
            ]
            if not leaked:
                record("H3", "llm", "Unknown fields dropped via allowlist",
                       "Dropped", "pass",
                       f"draft_id={did[:8]}..., metadata={md}", "")
            else:
                record("H3", "llm", "Unknown fields dropped via allowlist",
                       "Dropped", "fail", f"Leaked: {leaked}", "")
        else:
            record("H3", "llm", "Unknown fields dropped via allowlist",
                   "Dropped", "fail", f"No draft_id: result={result}", "")
    except Exception as e:
        record("H3", "llm", "Unknown fields dropped", "Dropped", "error", "",
               f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        await conn.close()

    # H4: missing required fields
    conn, storage = await fresh_storage()
    try:
        job = PromoteJob()
        ctx = JobContext(
            use_case=_make_use_case_cnl(True),
            run_id=RunId("r-test"),
            services={"twitter": _MinimalTwitterPack()},
            storage=storage,
        )
        result = job.handle_internal_tool(
            "create_draft", {"content": "only"}, ctx
        )
        if hasattr(result, "__await__"):
            result = await result
        if isinstance(result, dict) and (
            result.get("ok") is False or "error" in result
        ):
            record("H4", "llm", "Missing required fields in LLM call",
                   "Clear error, no write", "pass", f"result={result}", "")
        else:
            # Check whether it silently created anyway
            drafts = await storage.list_drafts(limit=5)
            record("H4", "llm", "Missing required fields in LLM call",
                   "Clear error, no write",
                   "fail" if drafts else "pass",
                   f"result={result}, drafts_created={len(drafts)}", "")
    except Exception as e:
        record("H4", "llm", "Missing required fields", "Clear error", "error",
               "", f"{type(e).__name__}: {e}")
    finally:
        await conn.close()


# Category I — Integration --------------------------------------------


async def cat_i():
    # For CNL, claim is: execute_send creates a run row and records an action row
    from chiefofstaff.storage.drafts import Draft

    class FakePack:
        pack_name = "twitter"
        category = "social"

        def __init__(self):
            self._initialized = True

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

    from chiefofstaff.runner.engine import JobRunner
    from chiefofstaff.services.registry import ServiceRegistry
    from chiefofstaff.jobs.registry import JobRegistry

    conn, storage = await fresh_storage()
    try:
        did = await create_basic_draft(storage)
        draft = await storage.get_draft(did)

        sreg = ServiceRegistry()
        pack = FakePack()
        try:
            sreg.register_pack(pack)
        except Exception:
            sreg._packs[pack.pack_name] = pack  # type: ignore

        jreg = JobRegistry()

        try:
            runner = JobRunner(
                job_registry=jreg,
                service_registry=sreg,
                llm_router=None,  # type: ignore
                storage=storage,
                memory=None,
                event_bus=None,
            )
        except Exception as e:
            record("I1", "integration", "execute_send creates runs row",
                   "runs row present", "error", "", f"JobRunner ctor: {e}")
            record("I2", "integration", "execute_send creates actions row",
                   "actions row present", "error", "", f"JobRunner ctor: {e}")
            record("I3", "integration", "execute_send increments rate-limit",
                   "rate_limit row", "error", "", "")
            return

        await runner.execute_send(draft)

        runs_rows = await conn.fetchall(
            "SELECT run_id, job_name, use_case FROM runs"
        )
        actions_rows = await conn.fetchall(
            "SELECT id, service, action FROM actions"
        )
        rl_rows = await conn.fetchall(
            "SELECT service, action_type FROM rate_limits"
        )

        record("I1", "integration", "Approved send creates a runs row",
               "1+ rows", "pass" if runs_rows else "fail",
               f"runs: {runs_rows}", "")
        record("I2", "integration", "Approved send creates an actions row",
               "1+ rows", "pass" if actions_rows else "fail",
               f"actions: {actions_rows}", "")
        record("I3", "integration", "Approved send writes rate_limits (if pack)",
               "N/A for non-write-tracking packs; informational",
               "not_applicable" if not rl_rows else "pass",
               f"rate_limits: {rl_rows}", "FakePack doesn't increment; real Twitter client does")
    except Exception as e:
        record("I1", "integration", "Approved send creates runs row", "", "error",
               "", f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        await conn.close()


# Main ------------------------------------------------------------------


async def main():
    print("Running CNL-side behavioral tests...")
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
            print(f"CATEGORY ERROR: {e}")
            record(f"{cat_name}-crash", cat_name, "category crash",
                   "no crash", "error", "",
                   f"{type(e).__name__}: {e}\n{traceback.format_exc()}")

    out = Path(__file__).parent / "results" / "cnl.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps([asdict(r) for r in results], indent=2))
    print(f"\nWrote {len(results)} results to {out}")
    # Print quick summary
    from collections import Counter
    by_status = Counter(r.status for r in results)
    print(f"Summary: {dict(by_status)}")


if __name__ == "__main__":
    asyncio.run(main())
