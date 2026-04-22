#!/usr/bin/env python3
"""Sum token usage from Codex rollout JSONL files.

Codex tracks cumulative usage in payload.info.total_token_usage per turn.
Last occurrence is the grand total for the session. If multiple rollouts
for the same worktree (session resumed), sum the last-occurrence of each.

Usage:
    python evals/codex_tokens.py <rollout.jsonl> [<rollout.jsonl> ...]
    python evals/codex_tokens.py --project <cwd>   # finds today's rollouts for that cwd
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

BASE = Path.home() / ".codex" / "sessions"


def last_total(path: Path) -> dict:
    """Return the final total_token_usage dict from this rollout, or zeros."""
    last = {
        "input_tokens": 0, "cached_input_tokens": 0,
        "output_tokens": 0, "reasoning_output_tokens": 0, "total_tokens": 0,
    }
    cwd = None
    for line in path.read_text().splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        p = obj.get("payload", {})
        if isinstance(p, dict):
            info = p.get("info")
            if isinstance(info, dict):
                t = info.get("total_token_usage")
                if isinstance(t, dict):
                    for k in last:
                        last[k] = int(t.get(k, 0) or 0)
            if cwd is None:
                c = p.get("cwd") or p.get("workdir") or p.get("working_dir")
                if c:
                    cwd = c
    last["_source"] = str(path)
    last["_cwd"] = cwd
    return last


def find_rollouts_for(cwd: str) -> list[Path]:
    """Walk today's sessions and filter rollouts whose cwd matches."""
    today = date.today().strftime("%Y/%m/%d")
    day_dir = BASE / today
    if not day_dir.is_dir():
        return []
    matches = []
    for f in sorted(day_dir.glob("*.jsonl")):
        # Peek at first few lines for cwd — cheap
        for line in f.read_text().splitlines()[:20]:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            p = obj.get("payload", {})
            if isinstance(p, dict):
                c = p.get("cwd") or p.get("workdir") or p.get("working_dir")
                if c == cwd:
                    matches.append(f)
                    break
    return matches


def summarize(paths: list[Path]) -> dict:
    """Aggregate across multiple rollouts: sum individual session totals."""
    combined = {
        "input_tokens": 0, "cached_input_tokens": 0,
        "output_tokens": 0, "reasoning_output_tokens": 0, "total_tokens": 0,
    }
    rollouts = []
    for p in paths:
        t = last_total(p)
        rollouts.append({k: v for k, v in t.items() if k != "_cwd"})
        for k in combined:
            combined[k] += t.get(k, 0)
    # GPT-5.4 high-reasoning tier (USD/MTok): input $2.50, cached $0.25, output $20.
    pricing = {"in": 2.50, "cin": 0.25, "out": 20.00}
    combined["cost_usd_approx"] = round(
        (combined["input_tokens"] * pricing["in"]
         + combined["cached_input_tokens"] * pricing["cin"]
         + (combined["output_tokens"] + combined["reasoning_output_tokens"]) * pricing["out"])
        / 1_000_000,
        2,
    )
    combined["rollouts"] = rollouts
    return combined


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    if sys.argv[1] == "--project":
        if len(sys.argv) < 3:
            print("usage: --project <cwd>", file=sys.stderr)
            return 2
        paths = find_rollouts_for(sys.argv[2])
        if not paths:
            print(f"no Codex rollouts found for {sys.argv[2]}", file=sys.stderr)
            return 1
    else:
        paths = [Path(p) for p in sys.argv[1:]]

    result = summarize(paths)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
