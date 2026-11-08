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

Atrium only displays the worker pool and will request an interactive lane. The
actual priority must be implemented in Ananta (lease priority + one reserved
interactive slot, fallback dedicated chat model). Atrium does not fake scheduling.
