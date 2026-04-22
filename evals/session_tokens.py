#!/usr/bin/env python3
"""Sum token usage from a Claude Code session JSONL transcript.

Usage:
    python evals/session_tokens.py <transcript.jsonl>
    python evals/session_tokens.py --project <cwd>           # finds latest session for that cwd
    python evals/session_tokens.py --list                    # lists all projects

Outputs JSON:
{
  "input_tokens": ...,
  "output_tokens": ...,
  "cache_creation_input_tokens": ...,
  "cache_read_input_tokens": ...,
  "total_uncached": input + output,
  "total_billable_approx": input + output + cache_creation (cache reads are ~free),
  "turns": <count of assistant messages>
}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path.home() / ".claude" / "projects"


def encode_cwd(cwd: str) -> str:
    """Replicate Claude Code's directory-name encoding: absolute path, "/" → "-"."""
    return cwd.replace("/", "-")


def find_latest_session(cwd: str) -> Path | None:
    encoded = encode_cwd(cwd)
    # encode_cwd produces "-Users-..." for absolute paths (leading slash becomes leading dash)
    project_dir = BASE / encoded
    if not project_dir.is_dir():
        return None
    files = sorted(project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def sum_tokens(path: Path) -> dict:
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "turns": 0,
    }
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("message")
        if not isinstance(msg, dict):
            continue
        usage = msg.get("usage")
        if not isinstance(usage, dict):
            continue
        totals["turns"] += 1
        for key in ("input_tokens", "output_tokens",
                    "cache_creation_input_tokens", "cache_read_input_tokens"):
            totals[key] += int(usage.get(key, 0) or 0)
    totals["total_uncached"] = totals["input_tokens"] + totals["output_tokens"]
    # Legacy field kept for backward compat — NOT an accurate bill estimate.
    totals["total_billable_approx"] = (
        totals["input_tokens"]
        + totals["output_tokens"]
        + totals["cache_creation_input_tokens"]
    )
    # Dollar estimate per model (published Anthropic rates, per 1M tokens).
    pricing = {
        "opus_4":   {"in": 15.00, "out": 75.00, "cw": 18.75, "cr": 1.50},
        "sonnet_4": {"in":  3.00, "out": 15.00, "cw":  3.75, "cr": 0.30},
        "haiku_4":  {"in":  1.00, "out":  5.00, "cw":  1.25, "cr": 0.10},
    }
    totals["cost_usd"] = {}
    for model, p in pricing.items():
        cost = (
            totals["input_tokens"] * p["in"]
            + totals["output_tokens"] * p["out"]
            + totals["cache_creation_input_tokens"] * p["cw"]
            + totals["cache_read_input_tokens"] * p["cr"]
        ) / 1_000_000
        totals["cost_usd"][model] = round(cost, 2)
    return totals


def list_projects() -> None:
    for p in sorted(BASE.iterdir()):
        if not p.is_dir():
            continue
        sessions = list(p.glob("*.jsonl"))
        if not sessions:
            continue
        latest = max(sessions, key=lambda f: f.stat().st_mtime)
        print(f"{p.name}\n    latest: {latest.name}  ({latest.stat().st_size // 1024} KB)")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    if sys.argv[1] == "--list":
        list_projects()
        return 0

    if sys.argv[1] == "--project":
        if len(sys.argv) < 3:
            print("usage: --project <cwd>", file=sys.stderr)
            return 2
        path = find_latest_session(sys.argv[2])
        if not path:
            print(f"no sessions found for {sys.argv[2]}", file=sys.stderr)
            return 1
    else:
        path = Path(sys.argv[1])

    totals = sum_tokens(path)
    totals["source"] = str(path)
    print(json.dumps(totals, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
