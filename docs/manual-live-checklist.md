# Live Ananta acceptance checklist (AT-109)

Automated coverage exists for the adapter, schema mapping, collector health,
WebSocket deltas, reconnect/backoff and the 2 s fake fallback. This checklist
covers what must be observed against a real hub because it needs credentials and
a running Ananta stack.

## Prerequisites

```bash
export ATRIUM_HUB_TOKEN=...            # or ATRIUM_HUB_TOKEN_FILE
export ATRIUM_SOURCE=live
export ATRIUM_HUB_URL=http://127.0.0.1:5000
npm run collector:dev
```

1. `curl -s http://127.0.0.1:8787/health` returns `200`, `source: live`,
   `agents >= 1`, `upstreams.hub.reachable: true`.
2. `curl -s -H "Authorization: Bearer $ATRIUM_HUB_TOKEN" \
   http://127.0.0.1:5000/api/sessions` lists at least five sessions.
3. Open the client, choose **Connect to Ananta**, keep the collector URL, and
   confirm the HUD badge switches from `FAKE` to `LIVE`.
4. Move between rooms and confirm five agents update task text/progress without a
   page reload.
5. Kill the collector (`Ctrl-C`). Within 2 s the badge returns to `FAKE` and the
   agents keep walking (labelled fake).
6. Restart the collector. The badge returns to `LIVE` without a reload.
7. Check `/health` shows `degraded` and a 503 while the hub is down, never an
   empty stream that looks live.

Record the result in the task notes with date, hub commit and session count.
