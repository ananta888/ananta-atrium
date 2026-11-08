# ADR 006 — Live trace, diffs and two chat modes

Status: accepted, live acceptance pending.

## Sources

- Task detail: `GET /api/tasks/<taskId>` (history, artifacts, verification, sessions).
- Diffs: the newest `workspace_diff` artifact (`text/x-diff`) fetched from
  `GET /api/artifacts/<id>/content`. It is produced by the worker at workspace
  sync points; source-control v1 exposes workspaces/snapshots, not a live diff.
- Live file activity: session tool-calls (`/api/sessions/<id>/tool-calls`).
- Queue: `GET /api/worker-pool/status`, `/queues`, `/leases` (read-only).
- Events: `/api/events/stream` (SSE, Last-Event-ID, reconnect) and `/snakes/<id>/events/stream`.

## Budgets and attempts

- Time budget: worker lease `acquired_at`/`deadline_at`.
- Tokens/cost: only when the hub cost summary contains them.
- Attempts: explicit task fields, otherwise derived from retry history.
- Missing data renders as unknown; the collector never invents numbers.

## Two chat modes

1. **Ask (side chat)** — `POST /snakes/<id>/chat/messages` with a chat session.
   The collector auto-creates one Snake per visual agent and stores the snake
   token and session mapping in `.atrium-chat-state.json` (mode 0600, gitignored).
   This never writes into the task session.
2. **Steer task** — `POST /api/tasks/<taskId>/commands` with
   `type: inject_instruction` and an explicit `mode` + `instruction_class`.
   This deliberately changes the running task; the UI labels it as an instruction,
   not as chat.

## eGPU priority

**Finding (2026-11-08):** the worker-pool scheduler is not on the main worker
dispatch path — only the spreadsheet adapter calls `acquire_for_job`. The active
leases in the running stack come from meet/legacy paths. A lease priority in the
scheduler therefore cannot throttle coding/LLM workers.

The viable options are:
1. a priority-aware proxy in front of the local Ollama/llama.cpp endpoint
   (interactive requests jump the queue, background requests are queued), or
2. a dedicated interactive chat model kept resident on the eGPU, or
3. wiring the main worker dispatch through the scheduler first, then using the
   priority leases from branch `feat/interactive-priority-lane`.

Atrium only displays the queue and never fakes scheduling.
