# Contributing

1. Read `AGENTS.md`. It is a contract, not a suggestion — especially the
   `src/sim` boundary and the todo workflow.
2. Pick one task from `todos/todo.ananta-atrium.json` whose `depends_on` are
   all `done`.
3. Keep changes small and verifiable. Add a test for new simulation or
   collector behaviour, and an e2e assertion for player-visible flows.
4. Before opening a PR:

   ```bash
   npm run check:boundary
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run e2e
   python3 devtools/todo.py recompute
   python3 devtools/todo.py validate
   ```

5. Update `ATTRIBUTION.md` for any new asset, and `docs/` when the contract,
   data format or setup changes.
6. Conventional Commits, one task per PR, reference the task id (`AT-101`).
