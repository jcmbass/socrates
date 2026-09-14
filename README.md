# Socrates

Socrates is a Socratic tutor for a cheap Android phone. This repository folder is named **buxo**; npm packages stay `@buxo/*`. The product name in the app is Socrates.

This tree is MIT. See [LICENSE](LICENSE). Topic lists under `packages/domain/data/seed/` stay Creative Commons Attribution 4.0 (CC BY 4.0); they are not MIT. See [NOTICE](NOTICE).

Tester observations in `docs/plan-beta-real/` are out of scope for contributors. That closed-beta folder stays private.

## Android

Student app: Expo in `apps/mobile`, package `com.socrates.tutor`.

1. `npm install`
2. `cp apps/mobile/.env.example apps/mobile/.env`
3. Point `EXPO_PUBLIC_API_BASE_URL` at your local server (`http://localhost:3001` on an emulator; use your machine LAN IP on a device).
4. `npm run android -w @buxo/mobile`

You need Android Studio / an emulator or a device with USB debugging. There is no public production URL in this README.

## Server

API: Hono in `apps/server` on port 3001. Open models go through DeepInfra or any OpenAI-compatible endpoint (`OLLAMA_BASE_URL`). Fake models are enough to confirm the process boots.

1. `npm install`
2. `cp apps/server/.env.example apps/server/.env`
3. Set `BUXO_ENV=dev` and `BUXO_FAKE_MODELS=1` in that file.
4. `npm run dev -w apps/server`
5. `curl -sS http://localhost:3001/healthz` — expect HTTP 200 and `"ok": true`.

Postgres (`DATABASE_URL`) is required before signup, sessions, or materials. A local instance is enough:

`docker run --rm -e POSTGRES_USER=buxo -e POSTGRES_PASSWORD=buxo -e POSTGRES_DB=buxo -p 5432:5432 postgres:16`

Then `npm run db:migrate -w apps/server`.

To call real models, unset `BUXO_FAKE_MODELS` and set `DEEPINFRA_API_KEY` (or point `OLLAMA_BASE_URL` at a local daemon). Staging and prod must set a random `JWT_SECRET`; the documented default is rejected outside `BUXO_ENV=dev`.

## Tests

From the repo root:

- `npm test -w apps/server`
- `npm test -w @buxo/domain`
- `npm test -w @buxo/mobile -- lib/`

See [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerability reports go to the address in [SECURITY.md](SECURITY.md).
