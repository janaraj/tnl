#!/usr/bin/env python3
"""evals/score.py — TNL-vs-baseline scorecard generator.

Auto-populates rows 1–8 and 11 from git + pytest + generated TNL files.
Rows 9–10 are filled in from the config (user captures during session).
Row 12 (silent decisions) is a manual tag — left blank unless provided.

Usage:
    python evals/score.py evals/triggers-config.json

Config shape: see triggers-config.example.json for a template.

Outputs:
    - JSON at config["out_json"]
    - Markdown table at config["out_md"]
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path


# ---------- helpers ----------


def run(cmd: list[str], cwd: str | None = None, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check)


def git_untracked_files(worktree: str) -> list[str]:
    r = run(["git", "ls-files", "--others", "--exclude-standard"], cwd=worktree)
    return [line for line in r.stdout.splitlines() if line.strip()]


def git_diff_numstat(worktree: str, base: str) -> list[tuple[int, int, str]]:
    r = run(["git", "diff", "--numstat", base], cwd=worktree)
    out: list[tuple[int, int, str]] = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, removed, path = parts
        try:
            out.append((int(added), int(removed), path))
        except ValueError:
            continue  # "-" for binary files
    # Include untracked files as fully-added
    for path in git_untracked_files(worktree):
        abs_path = Path(worktree) / path
        if abs_path.is_dir() or not abs_path.is_file():
            continue
        try:
            n_lines = sum(1 for _ in abs_path.open("rb"))
        except OSError:
            continue
        out.append((n_lines, 0, path))
    return out


def git_diff_body(worktree: str, base: str, paths: list[str] | None = None) -> str:
    cmd = ["git", "diff", base]
    if paths:
        cmd += ["--"] + paths
    r = run(cmd, cwd=worktree)
    body = r.stdout
    # Append synthetic "+" lines for each untracked file so grep-based counters catch them
    for rel in git_untracked_files(worktree):
        if paths and not any(rel == p or rel.startswith(p) for p in paths):
            continue
        abs_path = Path(worktree) / rel
        if abs_path.is_dir() or not abs_path.is_file():
            continue
        try:
            text = abs_path.read_text(errors="replace")
        except OSError:
            continue
        body += f"\ndiff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n"
        for line in text.splitlines():
            body += f"+{line}\n"
    return body


def is_prod(path: str) -> bool:
    return path.startswith("src/")


def is_test(path: str) -> bool:
    return path.startswith("tests/")


def is_in_feature_scope(path: str, feature_paths: list[str]) -> bool:
    return any(path == fp or path.startswith(fp) for fp in feature_paths)


# ---------- row computations ----------


def compute_files(numstat: list[tuple[int, int, str]]) -> dict:
    prod_files = [p for _, _, p in numstat if is_prod(p)]
    test_files = [p for _, _, p in numstat if is_test(p)]
    prod_added = sum(a for a, _, p in numstat if is_prod(p))
    prod_removed = sum(r for _, r, p in numstat if is_prod(p))
    return {
        "prod_files": prod_files,
        "test_files": test_files,
        "prod_files_count": len(prod_files),
        "prod_added": prod_added,
        "prod_removed": prod_removed,
        "prod_net": prod_added - prod_removed,
    }


def compute_scope_creep(prod_files: list[str], feature_paths: list[str]) -> list[str]:
    if not feature_paths:
        return []
    return [p for p in prod_files if not is_in_feature_scope(p, feature_paths)]


def count_new_tests(diff_body: str) -> int:
    """Count added test functions (Python: `+def test_`, TypeScript: `+it(`/`+test(`)."""
    count = 0
    for line in diff_body.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            stripped = line[1:].lstrip()
            if stripped.startswith("def test_") or stripped.startswith("async def test_"):
                count += 1
            elif re.match(r"(it|test)\s*\(", stripped):
                count += 1
    return count


def count_new_abstractions(worktree: str, base: str, numstat: list[tuple[int, int, str]]) -> dict:
    """Count new architectural abstractions in production code only.

    Counts:
      - classes that inherit from Protocol (protocols)
      - other classes, excluding Exception subclasses and common data-class base types
        (BaseModel, Enum, StrEnum, IntEnum, dataclass-decorated classes)
      - new module files in src/

    Excludes: tests/, test classes, exception classes, Pydantic/Enum data models.
    """
    prod_diff = git_diff_body(worktree, base, paths=["src/"])

    new_classes = 0
    new_protocols = 0
    exception_classes = 0
    data_classes = 0
    prev_line = ""
    data_bases = {"BaseModel", "Enum", "StrEnum", "IntEnum", "Dict", "TypedDict",
                  "NamedTuple", "Exception", "Error", "ValueError"}

    for line in prod_diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            stripped = line[1:].lstrip()
            if re.match(r"class\s+\w+.*Protocol", stripped):
                new_protocols += 1
            elif stripped.startswith("class "):
                # exception classes
                if re.search(r"\((\w+Error|\w+Exception|Exception|BaseException)[,)]", stripped):
                    exception_classes += 1
                elif any(f"({b}" in stripped or f", {b}" in stripped for b in data_bases):
                    data_classes += 1
                elif prev_line.strip() in ("@dataclass", "@dataclass(frozen=True)", "@dataclass()"):
                    data_classes += 1
                else:
                    new_classes += 1
            prev_line = stripped
        else:
            prev_line = ""

    # new modules in src/ (not tests/)
    new_modules = [
        p for a, r, p in numstat
        if is_prod(p) and r == 0 and a > 0
        and p.endswith((".py", ".ts", ".tsx", ".js", ".jsx"))
        and not p.endswith("__init__.py")
    ]
    return {
        "new_classes": new_classes,
        "new_protocols": new_protocols,
        "excluded_exception_classes": exception_classes,
        "excluded_data_classes": data_classes,
        "new_modules_count": len(new_modules),
        "new_modules": new_modules,
        "total": new_classes + new_protocols + len(new_modules),
    }


def count_must_clauses(worktree: str) -> int:
    """Count MUST/MUST NOT clauses across any tnl/*.tnl feature files (not workflow.tnl)."""
    tnl_dir = Path(worktree) / "tnl"
    if not tnl_dir.is_dir():
        return 0
    total = 0
    for f in tnl_dir.glob("*.tnl"):
        if f.name == "workflow.tnl":
            continue
        text = f.read_text(errors="replace")
        # Count clauses that start with `- ` and contain MUST or MUST NOT
        for line in text.splitlines():
            stripped = line.lstrip()
            if stripped.startswith("- ") and re.search(r"\bMUST\b", stripped):
                total += 1
    return total


def pytest_failing_tests(worktree: str, python_bin: str) -> set[str]:
    """Run pytest and return the set of failing-test nodeids. Empty set on clean run."""
    r = run([python_bin, "-m", "pytest", "--tb=no", "-q", "--no-header"], cwd=worktree)
    failing: set[str] = set()
    for line in r.stdout.splitlines():
        # Pytest prints "FAILED tests/...::TestClass::test_method - ..." on -q with -rf or --tb=no
        m = re.match(r"FAILED\s+(\S+)", line)
        if m:
            failing.add(m.group(1))
    return failing


def pytest_summary(worktree: str, python_bin: str) -> dict:
    r = run([python_bin, "-m", "pytest", "--tb=no", "-q"], cwd=worktree)
    passed = failed = errors = 0
    for line in r.stdout.splitlines() + r.stderr.splitlines():
        m = re.search(r"(\d+)\s+passed", line)
        if m:
            passed = int(m.group(1))
        m = re.search(r"(\d+)\s+failed", line)
        if m:
            failed = int(m.group(1))
        m = re.search(r"(\d+)\s+error", line)
        if m:
            errors = int(m.group(1))
    return {
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "total": passed + failed + errors,
    }


def regressions_and_fixes(worktree: str, python_bin: str) -> dict:
    """Compute regressions (green-at-base, red-now) and fixes (red-at-base, green-now).

    Also captures base total/pass/fail counts so consumers can verify
    "no tests were silently dropped" without needing an external reference.

    Uses `git stash -u` to preserve working-tree changes across the base run.
    """
    wt_failing = pytest_failing_tests(worktree, python_bin)

    stash_label = "score-py-eval"
    stash_push = run(["git", "stash", "push", "-u", "-m", stash_label], cwd=worktree)
    if "No local changes" in stash_push.stdout:
        return {
            "working_tree_failing": sorted(wt_failing),
            "base_failing": sorted(wt_failing),
            "base_summary": pytest_summary(worktree, python_bin),
            "regressions": [],
            "fixes": [],
        }

    try:
        base_failing = pytest_failing_tests(worktree, python_bin)
        base_summary = pytest_summary(worktree, python_bin)
    finally:
        run(["git", "stash", "pop"], cwd=worktree)

    return {
        "working_tree_failing": sorted(wt_failing),
        "base_failing": sorted(base_failing),
        "base_summary": base_summary,
        "regressions": sorted(wt_failing - base_failing),
        "fixes": sorted(base_failing - wt_failing),
    }


def parse_matrix_results(path: str | None) -> dict | None:
    if not path or not Path(path).is_file():
        return None
    data = json.loads(Path(path).read_text())
    counts = {"pass": 0, "fail": 0, "error": 0, "not_applicable": 0}
    for r in data:
        st = r.get("status", "unknown")
        counts[st] = counts.get(st, 0) + 1
    non_na = counts["pass"] + counts["fail"] + counts["error"]
    pct = round(100 * counts["pass"] / non_na, 1) if non_na else None
    return {
        "total": len(data),
        "counts": counts,
        "non_na": non_na,
        "pass_pct_non_na": pct,
    }


# ---------- per-impl scorecard ----------


@dataclass
class ImplScore:
    name: str
    functional_completeness: dict | None = None
    regressions_introduced: int = 0
    regression_details: list[str] = field(default_factory=list)
    fixes_along_way: int = 0
    fix_details: list[str] = field(default_factory=list)
    full_suite: dict = field(default_factory=dict)
    base_suite: dict = field(default_factory=dict)
    tests_net_delta: int = 0
    new_tests: int = 0
    prod_files_modified: int = 0
    scope_creep_files: list[str] = field(default_factory=list)
    prod_loc_added: int = 0
    prod_loc_removed: int = 0
    prod_loc_net: int = 0
    new_abstractions: dict = field(default_factory=dict)
    wallclock_minutes: float | None = None
    token_cost_approx: int | None = None
    must_clauses: int = 0
    silent_decisions: int | None = None


def score_impl(name: str, impl_cfg: dict, base: str, feature_paths: list[str]) -> ImplScore:
    worktree = impl_cfg["worktree"]
    python_bin = impl_cfg.get("python_bin", os.path.join(worktree, ".venv/bin/python"))

    print(f"[score] {name}: gathering diff stats…", file=sys.stderr)
    numstat = git_diff_numstat(worktree, base)
    files = compute_files(numstat)
    creep = compute_scope_creep(files["prod_files"], feature_paths)

    print(f"[score] {name}: scanning diff body…", file=sys.stderr)
    # Full diff body (for detecting new tests)
    diff_all = git_diff_body(worktree, base)
    new_tests_count = count_new_tests(diff_all)
    # Abstractions pulled from src/ only, with exclusions
    abstractions = count_new_abstractions(worktree, base, numstat)

    print(f"[score] {name}: counting MUST clauses in tnl/…", file=sys.stderr)
    musts = count_must_clauses(worktree)

    print(f"[score] {name}: running pytest (working tree)…", file=sys.stderr)
    suite = pytest_summary(worktree, python_bin)

    print(f"[score] {name}: computing regressions (stash-test-unstash)…", file=sys.stderr)
    reg = regressions_and_fixes(worktree, python_bin)

    matrix = parse_matrix_results(impl_cfg.get("matrix_results"))

    base = reg.get("base_summary", {})
    return ImplScore(
        name=name,
        functional_completeness=matrix,
        regressions_introduced=len(reg["regressions"]),
        regression_details=reg["regressions"],
        fixes_along_way=len(reg["fixes"]),
        fix_details=reg["fixes"],
        full_suite=suite,
        base_suite=base,
        tests_net_delta=suite.get("total", 0) - base.get("total", 0),
        new_tests=new_tests_count,
        prod_files_modified=files["prod_files_count"],
        scope_creep_files=creep,
        prod_loc_added=files["prod_added"],
        prod_loc_removed=files["prod_removed"],
        prod_loc_net=files["prod_net"],
        new_abstractions=abstractions,
        wallclock_minutes=impl_cfg.get("wallclock_minutes"),
        token_cost_approx=impl_cfg.get("token_cost_approx"),
        must_clauses=musts,
        silent_decisions=impl_cfg.get("silent_decisions"),
    )


# ---------- output ----------


def fmt_completeness(m: dict | None) -> str:
    if not m:
        return "—"
    pct = m.get("pass_pct_non_na")
    pcount = m["counts"]["pass"]
    total = m["non_na"]
    return f"{pcount}/{total} ({pct}%)" if pct is not None else f"{pcount}/{total}"


def fmt_suite(s: dict) -> str:
    total = s.get("total", 0)
    passed = s.get("passed", 0)
    failed = s.get("failed", 0)
    errors = s.get("errors", 0)
    if not total:
        return "—"
    tail = ""
    if failed or errors:
        tail = f" ({failed}f/{errors}e)"
    return f"{passed}/{total}{tail}"


def fmt_optional(v, unit: str = "") -> str:
    if v is None:
        return "—"
    return f"{v}{unit}"


def render_table(task: str, scores: list[ImplScore]) -> str:
    names = [s.name for s in scores]
    header = "| # | Metric | " + " | ".join(names) + " |"
    sep = "|---|---|" + "|".join(["---"] * len(names)) + "|"

    rows = []
    def row(n, label, vals):
        rows.append(f"| {n} | {label} | " + " | ".join(vals) + " |")

    row(1, "Functional completeness (matrix pass %)",
        [fmt_completeness(s.functional_completeness) for s in scores])
    row(2, "Regressions introduced",
        [str(s.regressions_introduced) for s in scores])
    row(3, "Full-suite pass rate",
        [fmt_suite(s.full_suite) for s in scores])
    row("3b", "Base test total (pristine eb49b71)",
        [str(s.base_suite.get("total", 0)) for s in scores])
    row("3c", "Net test-count delta vs base",
        [f"{s.tests_net_delta:+d}" for s in scores])
    row(4, "New test functions (added to diff)",
        [str(s.new_tests) for s in scores])
    row(5, "Production files modified",
        [str(s.prod_files_modified) for s in scores])
    row(6, "Scope-creep files (outside `feature_paths`)",
        [str(len(s.scope_creep_files)) for s in scores])
    row(7, "Net production LOC (+/−)",
        [f"+{s.prod_loc_added}/−{s.prod_loc_removed}" for s in scores])
    row(8, "New abstractions (classes + protocols + modules)",
        [str(s.new_abstractions.get("total", 0)) for s in scores])
    row(9, "Session wall-clock (min)",
        [fmt_optional(s.wallclock_minutes) for s in scores])
    row(10, "Decisions pinned explicitly (MUST clauses in TNL)",
        [str(s.must_clauses) for s in scores])
    row(11, "Decisions silently guessed (manual tag)",
        [fmt_optional(s.silent_decisions) for s in scores])

    parts = [f"# Scorecard — {task}", "", header, sep] + rows

    # Addenda
    for s in scores:
        if s.regression_details:
            parts += ["", f"### {s.name} — regressions (green at base, red now)"]
            for t in s.regression_details:
                parts.append(f"- `{t}`")
        if s.fixes_along_way:
            parts += ["", f"### {s.name} — pre-existing failures fixed (red at base, green now)"]
            for t in s.fix_details:
                parts.append(f"- `{t}`")
        if s.scope_creep_files:
            parts += ["", f"### {s.name} — files outside `feature_paths`"]
            for f in s.scope_creep_files:
                parts.append(f"- `{f}`")

    return "\n".join(parts) + "\n"


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <config.json>", file=sys.stderr)
        return 2

    cfg = json.loads(Path(sys.argv[1]).read_text())
    base = cfg["base"]
    feature_paths = cfg.get("feature_paths", [])
    task = cfg.get("task", "task")

    scores: list[ImplScore] = []
    for name, impl_cfg in cfg["impls"].items():
        scores.append(score_impl(name, impl_cfg, base, feature_paths))

    out_json = cfg.get("out_json")
    out_md = cfg.get("out_md")

    summary = {
        "task": task,
        "base": base,
        "feature_paths": feature_paths,
        "scores": [asdict(s) for s in scores],
    }

    if out_json:
        Path(out_json).write_text(json.dumps(summary, indent=2))
        print(f"[score] wrote JSON: {out_json}", file=sys.stderr)

    md = render_table(task, scores)
    if out_md:
        Path(out_md).write_text(md)
        print(f"[score] wrote MD: {out_md}", file=sys.stderr)

    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
