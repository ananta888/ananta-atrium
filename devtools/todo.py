#!/usr/bin/env python3
"""Todo tooling for Ananta Atrium.

Subcommands:
  validate [path]   validate the todo JSON against its schema + quality gates
  recompute [path]  derive all summaries from tasks/milestones, rewrite the file,
                    then validate

The two schemas are copied verbatim from the Ananta planning contract:
  todos/todo.schema.json        Category / portfolio format (categories + items)
  todos/todo.track.schema.json  Task-track format (milestones + tasks)

Format is auto-detected: a payload with `tasks` and `milestones` is task-track,
everything else is the category format.

Requires: python3 + jsonschema (`pip install jsonschema`).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
TODO_DIR = ROOT / "todos"
DEFAULT_TODO = TODO_DIR / "todo.ananta-atrium.json"

STATUSES = ["todo", "in_progress", "partial", "blocked", "done"]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def detect_format(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("tasks"), list) and isinstance(payload.get("milestones"), list):
        return "task_track"
    return "category_meta"


def schema_path_for(fmt: str) -> Path:
    name = "todo.track.schema.json" if fmt == "task_track" else "todo.schema.json"
    path = TODO_DIR / name
    if not path.is_file():
        raise SystemExit(f"schema not found: {path}")
    return path


def validate_payload(payload: dict[str, Any]) -> list[str]:
    """Schema validation plus project quality gates. Returns a list of errors."""
    fmt = detect_format(payload)
    validator = Draft202012Validator(load_json(schema_path_for(fmt)))
    errors = [
        f"{'.'.join(str(p) for p in err.path) or '<root>'}: {err.message}"
        for err in sorted(validator.iter_errors(payload), key=lambda e: list(e.path))
    ]

    if fmt == "task_track":
        errors.extend(task_track_quality_gates(payload))
    return errors


def task_track_quality_gates(payload: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    tasks = payload.get("tasks", [])
    milestones = payload.get("milestones", [])

    ids: list[str] = []
    for t in tasks:
        tid = t.get("id")
        if tid in ids:
            problems.append(f"duplicate task id: {tid}")
        ids.append(tid)

    known = set(ids)
    for t in tasks:
        tid = t.get("id")
        status = t.get("status")
        if status not in STATUSES:
            problems.append(f"{tid}: status '{status}' is not one of {STATUSES}")
        pct = t.get("progress_percent")
        if isinstance(pct, (int, float)):
            if status == "todo" and pct != 0:
                problems.append(f"{tid}: status todo must have progress_percent 0")
            if status == "done" and pct != 100:
                problems.append(f"{tid}: status done must have progress_percent 100")
            if status in {"in_progress", "partial", "blocked"} and not (1 <= pct <= 99):
                problems.append(f"{tid}: status {status} must have progress_percent 1..99")
        for dep in t.get("depends_on", []):
            if dep not in known:
                problems.append(f"{tid}: depends_on unknown task id '{dep}'")

    for m in milestones:
        for tid in m.get("task_ids", []):
            if tid not in known:
                problems.append(f"milestone {m.get('id')}: unknown task id '{tid}'")
    for tid in payload.get("critical_path_tasks", []):
        if tid not in known:
            problems.append(f"critical_path_tasks: unknown task id '{tid}'")

    # Summaries must match what recompute would produce (compare the fields we own).
    expected = compute_summaries(payload)
    for key in ("tasks_status_summary", "tasks_type_summary", "progress_summary"):
        if payload.get(key) != expected[key]:
            problems.append(
                f"{key}: stale — run `python3 devtools/todo.py recompute`"
            )
    return problems


def summarize_by(tasks: list[dict[str, Any]], field: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in tasks:
        key = str(t.get(field, "unspecified"))
        out[key] = out.get(key, 0) + 1
    return dict(sorted(out.items()))


def derive_milestone_status(milestone: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> str:
    statuses = [by_id[tid]["status"] for tid in milestone.get("task_ids", []) if tid in by_id]
    if not statuses:
        return "todo"
    if all(s == "done" for s in statuses):
        return "done"
    if any(s in {"in_progress", "partial", "done"} for s in statuses):
        return "in_progress"
    if any(s == "blocked" for s in statuses):
        return "blocked"
    return "todo"


def compute_summaries(payload: dict[str, Any]) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = payload.get("tasks", [])
    milestones: list[dict[str, Any]] = payload.get("milestones", [])
    by_id = {t["id"]: t for t in tasks}

    by_status = {s: 0 for s in STATUSES}
    for t in tasks:
        by_status[t.get("status", "todo")] += 1
    total = len(tasks)
    done = by_status["done"]

    cp_ids = payload.get("critical_path_tasks", [])
    cp_done = sum(1 for tid in cp_ids if by_id.get(tid, {}).get("status") == "done")

    derived_statuses = [derive_milestone_status(m, by_id) for m in milestones]
    ms_counts = {
        "total": len(milestones),
        "todo": derived_statuses.count("todo"),
        "in_progress": derived_statuses.count("in_progress"),
        "blocked": derived_statuses.count("blocked"),
        "done": derived_statuses.count("done"),
    }

    tasks_status_summary = {
        "total": total,
        "by_status": by_status,
        "progress_percent_done": round(100 * done / total, 1) if total else 0.0,
        "by_priority": summarize_by(tasks, "priority"),
        "by_risk": summarize_by(tasks, "risk"),
        "critical_path": {
            "total": len(cp_ids),
            "done": cp_done,
            "remaining": len(cp_ids) - cp_done,
        },
        "milestones": ms_counts,
    }

    by_type: dict[str, dict[str, Any]] = {}
    for t in tasks:
        ty = str(t.get("type", "unspecified"))
        row = by_type.setdefault(
            ty,
            {
                "total": 0,
                "done": 0,
                "partial": 0,
                "blocked": 0,
                "by_status": {s: 0 for s in STATUSES},
            },
        )
        row["total"] += 1
        row["by_status"][t.get("status", "todo")] += 1
    for row in by_type.values():
        row["done"] = row["by_status"]["done"]
        row["partial"] = row["by_status"]["partial"]
        row["blocked"] = row["by_status"]["blocked"]
        row["progress_percent"] = (
            round(100 * row["done"] / row["total"], 1) if row["total"] else 0.0
        )
    tasks_type_summary = {
        "total": total,
        "by_type": dict(sorted(by_type.items())),
    }

    if total and done == total:
        state = "complete"
    elif by_status["blocked"]:
        state = "blocked"
    elif by_status["in_progress"] or by_status["partial"]:
        state = "in_progress"
    else:
        state = "planned"
    progress_summary = {
        "state": state,
        "todo_remaining": by_status["todo"],
        "in_progress": by_status["in_progress"],
        "partial": by_status["partial"],
        "blocked": by_status["blocked"],
        "done": by_status["done"],
    }

    return {
        "tasks_status_summary": tasks_status_summary,
        "tasks_type_summary": tasks_type_summary,
        "progress_summary": progress_summary,
        "milestone_statuses": derived_statuses,
    }


def cmd_recompute(path: Path) -> int:
    payload = load_json(path)
    if detect_format(payload) != "task_track":
        print(f"{path}: category format — summaries are not derived by this tool")
        return 0
    summaries = compute_summaries(payload)
    payload["tasks_status_summary"] = summaries["tasks_status_summary"]
    payload["tasks_type_summary"] = summaries["tasks_type_summary"]
    payload["progress_summary"] = summaries["progress_summary"]
    for milestone, status in zip(payload["milestones"], summaries["milestone_statuses"]):
        milestone["status"] = status
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{path}: summaries recomputed")
    return 0


def cmd_validate(path: Path) -> int:
    if not path.is_file():
        print(f"{path}: not found")
        return 1
    payload = load_json(path)
    fmt = detect_format(payload)
    errors = validate_payload(payload)
    if errors:
        print(f"{path}: invalid (format={fmt})")
        for err in errors:
            print(f"  - {err}")
        return 1
    print(f"{path}: valid (format={fmt})")
    return 0


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "validate"
    if command not in {"validate", "recompute"}:
        print(__doc__)
        return 2
    path = Path(argv[1]).resolve() if len(argv) > 1 else DEFAULT_TODO
    if command == "recompute":
        rc = cmd_recompute(path)
        if rc:
            return rc
    return cmd_validate(path)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
