# Contributing to Socrates

The app display name is Socrates. The repo folder is buxo. Please keep both.

## Scope

This public tree is `apps/mobile`, `apps/server`, and `packages/*`. Closed-beta tester notes in `docs/plan-beta-real/` are out of scope. Do not add a production host to README.

## Setup

Follow the server and Android steps in [README.md](README.md). `BUXO_FAKE_MODELS=1` with `BUXO_ENV=dev` is the stranger path. It must never be true outside dev.

## Checks

Run these from the repo root before you open a PR:

```sh
npm test -w apps/server
npm test -w @buxo/domain
npm run typecheck --workspaces --if-present
```

`npm test -w apps/server` is the named command this file expects to exit 0.

## Patches

- Conventional Commits (`fix(server):`, `chore(oss):`, …).
- Keep `"private": true` on workspace `package.json` files.
- Seed JSON under `packages/domain/data/seed/` stays CC BY 4.0. Do not relicense it as MIT.
- Do not commit `.env` files, API keys, or session tokens.
