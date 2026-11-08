# Ananta integration reference

This document is the concrete contract between Ananta Atrium and the local
Ananta stack. It was verified on 2026-11-08 against a running local stack.

## Where Ananta lives

| Item | Value |
|---|---|
| Repository | `https://github.com/ananta888/ananta` |
| Local checkout | sibling directory of this repo (`../ananta`) |
| Runtime | Docker Compose project **`compose-next`** |
| Hub | Flask/Werkzeug service, default `http://127.0.0.1:5000` |
| Hub CORS origin | `http://127.0.0.1:4200` (control centre) |
| Model runtimes | llama.cpp containers, published on loopback ports from the compose file (for example `18150`, `18151`, `18152` — **not** 8080) |

Do not hard-code these in application code. They are configuration:

```bash
ATRIUM_HUB_URL=http://127.0.0.1:5000
ATRIUM_HUB_TOKEN=...            # or ATRIUM_HUB_TOKEN_FILE=/run/secrets/ananta-token
ATRIUM_LLAMA_URLS=http://127.0.0.1:18150
```

## Authentication

Every `/api/*` route used here is wrapped in `check_auth`. A request without a
token receives `401`/`403` with the standard error envelope:

```json
{ "status": "error", "message": "unauthorized", "data": { "details": "Missing Authorization (header or token param)" } }
```

The collector sends:

```
Authorization: Bearer <token>
```

Rules:

- The token belongs to a hub user/agent with read access to sessions and tasks.
- Sessions are filtered by `owner_user_id`; a token only sees its own sessions.
- The browser never receives this token. The client only talks to the
  collector's WebSocket.
- Never log the token. The collector logs only the upstream error message.

## Endpoints the collector uses

### `GET /api/workers` (primary live source)

Returns the registered worker agents (`id`, `url`, `role`, `health`, `runtime`,
`worker_roles`, `capabilities`). The collector maps one atrium agent per worker,
with its current assigned task and the next queued task, plus the organization
path (`team_id`, `project_id`, `goal_id`, `plan_node_id`).

Role names come from `GET /teams` plus `GET /teams/roles`: `team_members` map
`agent_url` to `role_id`, so a worker is displayed with its real team role
(for example "Reviewer" or "Test Automation Engineer") instead of only the
container name.

### `GET /tasks` (task fallback)

Live hubs may run task workers without `agent_sessions` rows. The collector then
maps active/recent tasks (`running`, `proposing`, `paused`, `blocked_by_dependency`,
`waiting_for_review`, `updated`) to agents. The list endpoint is `/tasks`, not
`/api/tasks`.

### `GET /api/sessions`

Primary source of agent identity. Response envelope:

```json
{
  "status": "ok",
  "data": {
    "items": [
      {
        "id": "session-uuid",
        "task_id": "task-uuid",
        "title": "Task Session",
        "status": "running",
        "worker_id": "worker-alpha",
        "worker_type": "code",
        "model": "qwen",
        "runtime": "llama.cpp",
        "updated_at": 1760000000.123
      }
    ],
    "count": 1
  }
}
```

Status values are normalized by the hub to:
`idle`, `proposed`, `running`, `waiting_for_approval`, `blocked`, `review`,
`verified`, `done`, `failed`, `cancelled`.

Mapping to `AgentState.status`:

| Hub session status | AgentState |
|---|---|
| `running` | `working` |
| `review`, `verified` | `reviewing` |
| `proposed`, `waiting_for_approval`, `blocked` | `waiting` |
| `idle`, `done` | `idle` |
| `failed`, `cancelled` | `offline` |

### `GET /api/tasks?limit=200`

Optional decoration for task title and progress. The adapter tolerates both an
array and `{ "data": { "items": [...] } }`; if the endpoint fails, session
titles are used and the agents stay visible.

### `GET /api/tasks/<taskId>` and `GET /api/sessions/<sessionId>`

Single-resource detail endpoints, used for manual verification and future
drill-down. Not required by the current collector loop.

### `GET /api/tasks/<taskId>/control-state`

Run-control snapshot for one task: branch/command state used by the control
centre. The collector does not poll it (sessions already carry status), but it is
the correct drill-down endpoint when a task looks stuck. Response is wrapped in
the standard `{ status, data }` envelope.

### `GET /api/events/stream` (SSE)

Central live feed, `text/event-stream`, supports `Last-Event-ID`. A short-lived
stream token can be minted with `POST /api/events/stream-token`; the browser
EventSource must not carry the long-lived bearer token in the URL.

The current collector **polls** sessions every second. The SSE feed is the
intended upgrade for lower latency and is the reason the client protocol is
delta-based, but polling is sufficient for the atrium's 5–10 Hz state rate.

## llama.cpp

Used for throughput only:

| Endpoint | Use |
|---|---|
| `GET /slots` | per-slot `n_decoded`, `is_processing`; delta over time gives tokens/s |
| `GET /metrics` | Prometheus counters; optional fallback |

llama.cpp does **not** provide agent identity or task text. Those come from the
Ananta hub. When several agents run on one runtime, the collector divides the
measured throughput evenly across working agents — this is an approximation and
is labelled as such in the UI.

## Live trace, diffs, chat and queue

| Need | Endpoint |
|---|---|
| Task list (fallback source) | `GET /tasks?limit=200` (note: no `/api` prefix) |
| Task detail/history/artifacts | `GET /api/tasks/<taskId>` |
| Workspace diff | newest `workspace_diff` artifact via `GET /api/artifacts/<id>/content` |
| Live file writes | `GET /api/sessions/<id>/tool-calls` |
| Queue/leases | `GET /api/worker-pool/status`, `/queues`, `/leases` |
| Side chat | `POST /snakes/<id>/chat/messages` (+ `/api/chat/sessions`) |
| Work steering | `POST /api/tasks/<taskId>/commands` with `inject_instruction` |
| Events | `GET /api/events/stream`, `/snakes/<id>/events/stream` |

Side chat needs both credentials: the Snake token in `Authorization` and the
user JWT in `X-Ananta-User-Authorization`. The collector stores Snake tokens in
`.atrium-chat-state.json` (gitignored, mode 0600).

## Browser access to the local collector

An HTTPS page cannot open `ws://127.0.0.1` (Chrome logs
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). Live data therefore requires one of:

- the app served locally (`npm run dev`, then `http://localhost:5173`),
- a `wss://` tunnel/reverse proxy in front of the collector.

The connect dialog shows this warning when an insecure local URL is used from an
HTTPS page.

## Spectator control

The collector exposes an operator-only revocation endpoint:

```bash
curl -X POST http://127.0.0.1:8787/spectate/revoke \
  -H "x-atrium-admin-token: $ATRIUM_ADMIN_TOKEN"
# {"revoked":1}
```

Clients connect with `?spectator=1` on the collector WebSocket (the client's
`?spectator=1` page URL does this automatically). Revocation closes those
sockets with code 4001; normal clients are untouched. `GET /spectate/status`
reports the spectator count. The admin token is separate from the hub token and
never reaches the browser.

## Gaps and next steps

- No per-slot → session attribution yet; throughput is shared per runtime.
- Task progress is a heuristic when the task record has no progress field.
- SSE consumption is not implemented; the collector polls.
- Role/scope requirements depend on the Ananta deployment; verify with
  `GET /api/sessions` before running the collector in `live` mode.

## Verification

```bash
# 1. Hub is up and rejects anonymous requests
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/sessions

# 2. Authorized request returns sessions
curl -s -H "Authorization: Bearer $ATRIUM_HUB_TOKEN" \
  http://127.0.0.1:5000/api/sessions | head -c 400

# 3. Collector health (after starting it in live mode)
curl -s http://127.0.0.1:8787/health
```
