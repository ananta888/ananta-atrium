# Priority-aware LLM proxy

Fronts a local Ollama or llama.cpp runtime and gives interactive chat priority
over background worker traffic. Running requests are **not** preempted (the
runtime cannot do that); interactive requests take the next free slot and jump
the queue, with a starvation guard for background work.

```
Ananta workers ──► :11500 (batch lane) ─┐
                                        ├─► upstream :11434 / :18150
AI-Snake chat ───► :11501 (interactive) ┘
```

## Run

```bash
ATRIUM_PROXY_UPSTREAM=http://127.0.0.1:11434 \
ATRIUM_PROXY_SLOTS=1 npm run proxy:dev
```

| Endpoint | Meaning |
|---|---|
| `http://127.0.0.1:11500` | batch lane (background priority) |
| `http://127.0.0.1:11501` | interactive lane (jumps the queue) |
| `/__proxy/health` | liveness |
| `/__proxy/stats` | active, queued, served, max wait, upstream errors |

Any HTTP method/path is forwarded unchanged, including streaming responses.

## Wire Ananta

- Point background model/worker base URLs at the **batch** port.
- Point the AI-Snake chat provider (`api_base`) at the **interactive** port.
- Keep `ATRIUM_PROXY_SLOTS` equal to the runtime's real parallel slot count
  (`--parallel` for llama.cpp, `OLLAMA_NUM_PARALLEL` for Ollama).

No Ananta code change is required; this is deployment configuration. The proxy
only schedules; it never fakes a queue. If the runtime has one slot, an
already-running background generation still finishes first — the proxy cannot
preempt it.

## Verify ordering

```bash
# start a slow background request, then a short interactive one
curl -s http://127.0.0.1:11500/v1/chat/completions -d '{"messages":[{"role":"user","content":"write 200 words"}]}' &
curl -s http://127.0.0.1:11501/v1/chat/completions -d '{"messages":[{"role":"user","content":"say hi"}]}'
curl -s http://127.0.0.1:11500/__proxy/stats
```

The interactive request is served before queued background work.

## Measured ordering (live, 2026-11-08)

Upstream: llama.cpp `ananta-code-27b` on `:18150`, proxy slots `1`.
Sequence: background → background → interactive (150 ms apart).

| Request | Completion | Result |
|---|---|---|
| background #1 | 5.7 s | completes first |
| interactive | 11.8 s | runs **before** queued background #2 |
| background #2 | 19.2 s | waits for both |

The interactive request does not preempt the already-running generation — no
runtime can do that safely. It gets the next free slot ahead of all queued
background work. With more runtime slots (`ATRIUM_PROXY_SLOTS`), interactive
latency drops further.
