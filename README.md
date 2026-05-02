# Litour (formerly heltour)

League management software for chess leagues on Lichess, now branded as lots.lichess.ca.

# Quick Start

## Prerequisites

- [devenv](https://devenv.sh) 2.x (provides Postgres, Redis, Mailpit, Python, Ruby — no Docker required for dev)
- invoke

## Development Setup

```bash
# 1. Copy the development environment file
cp .env.dev .env

# 2. Enter the devenv development shell (installs Python deps automatically)
devenv shell

# 3. Start all services and processes (postgres, redis, mailpit, django, apiworker, celery)
devenv up

# In another shell (also inside `devenv shell`):

# 4. Run database migrations
invoke migrate

# 5. Create a superuser account
invoke createsuperuser
```

The site will be available at <http://localhost:8000>

### What `devenv up` runs

Services:

- **PostgreSQL 15** on `localhost:5432` (db `heltour`, user `heltour`, password `heltour_dev_password`)
- **Redis** on `localhost:6379`
- **Mailpit** — SMTP on `1025`, web UI at <http://localhost:8025>

Processes:

- **django** — `invoke runserver` (port 8000)
- **apiworker** — `invoke runapiworker` (port 8880)
- **runapi** — `invoke runapi` (FastAPI on port 8001) — see [Live API service](#live-api-service)
- **celery** — `invoke celery`
- **watch-games** — `invoke watch-games`

Stop everything with `Ctrl-C` in the `devenv up` window. Service data persists under `.devenv/state/` between runs.

## Live API service

A long-running process at `heltour/api/` (FastAPI + Uvicorn) serves a typed REST + WebSocket surface. The first feature it backs is the **live-updating pairings page**: when a `PlayerPairing` result or game link changes, the Django side publishes to Redis pub/sub and the FastAPI service forwards the event to subscribed browsers, which patch the summary block at the top of the page in place.

### Running it locally

`devenv up` already runs Postgres, Redis, Django, the API worker, and the FastAPI service together. To run the FastAPI piece on its own:

```bash
devenv shell                      # one terminal in the env
invoke runserver                  # Django :8000     (terminal A)
invoke runapi                     # FastAPI :8001    (terminal B)
invoke build-api-client           # rebuild the in-browser TS bundle (one-shot)
```

Then open a pairings page; with `LITOUR_API_BASE_URL` set in `.env` (default points at `http://localhost:8001`), the page will connect to `ws://localhost:8001/ws/pairings/{round_id}` and update the summary live as you edit pairings in the Django admin.

### What's deployed where

| Path | Process | Container image | Notes |
| --- | --- | --- | --- |
| `heltour/` (Django) | gunicorn `:8000` | `litour-web` | Existing site. Publishes pub/sub events on result/game-link change via `heltour/tournament/signals_pubsub.py`. |
| `heltour/api_worker/` | Django `:8880` | `litour-api-worker` | Unchanged. Lichess-side proxy/watcher. |
| `heltour/api/` | uvicorn `:8001` | `litour-api` | New. FastAPI + WebSocket. No Django templates. |
| `heltour/tournament/api.py` | served by web | (no separate image) | Existing token-authenticated REST API. Untouched. |

### Endpoints

- `GET /health` — liveness
- `GET /v1/rounds/{round_id}/pairings` — JSON list, used by the in-browser summary refresh
- `GET /v1/leagues/{league_tag}/current-round` — convenience for clients
- `WebSocket /ws/pairings/{round_id}` — public, no auth; emits `pairing.result` and `pairing.game_link` messages
- `GET /docs` — Scalar UI for the OpenAPI schema

### Typed TypeScript client (`clients/ts/`)

The OpenAPI schema is exported from the live FastAPI app and used to generate strongly-typed bindings via `openapi-typescript` + `openapi-fetch`. WebSocket messages are validated at runtime with a hand-written `zod` discriminated union (`src/ws-messages.ts`). The whole thing is then bundled into a self-contained IIFE that the Django pairings template loads via `{% static %}` and calls as `window.LitourApi.connectPairingStream(...)`.

```bash
invoke openapi             # python scripts/export_openapi.py > openapi.json
invoke build-api-client    # full pipeline: openapi + npm install + generate + bundle + copy
invoke fuzz                # schemathesis run openapi.json --base-url=http://localhost:8001
```

`invoke build-api-client` produces `heltour/tournament/static/tournament/js/litour-api-client.iife.js`, which `collectstatic` then picks up. The same pipeline runs inside `docker/Dockerfile.base` (Node 20 is installed there) so the `litour-web` and `litour-caddy` images ship the bundle without any extra step in deploy.

### CI

GitHub Actions:

- **`docker-build.yml`** — on push to `master` and on PRs touching docker bits. Builds **all** images via `docker buildx bake` against `docker/docker-bake.hcl`, including the new `litour-api` target. Pushes to ghcr.io on `master`. Because `Dockerfile.base` runs `npm install && npm run bundle` during the build, this also exercises the TS bundle step end-to-end.
- **`api-contract.yml`** — on changes to `heltour/api/**`, `heltour/tournament/models.py`, `heltour/tournament/signals_pubsub.py`, `clients/ts/**`, or the schema scripts. It boots the FastAPI service against ephemeral Postgres+Redis containers, exports `openapi.json`, runs **Schemathesis** against the live service, then `npm install && npm run generate && npm run typecheck && npm run build && npm run bundle && npm run lint`. Finally `git diff --exit-code clients/ts/src/generated.ts` fails the build if the committed generated client has drifted from the schema.
- **`deploy.yml`** — unchanged; chains off `docker-build.yml` to roll the staging stack on `master`.

### How to run *everything* end-to-end

```bash
devenv up                                    # postgres+redis+mailpit + django+apiworker+runapi+celery+watch-games

# In another `devenv shell`:
invoke build-api-client                      # one-time / when schema or TS sources change

# Verify the contract
invoke openapi                               # writes openapi.json
invoke fuzz                                  # schemathesis against :8001
curl -s http://localhost:8001/health          # {"ok": true}
curl -s http://localhost:8001/v1/rounds/1/pairings | head
wscat -c ws://localhost:8001/ws/pairings/1   # then edit a result in admin

# Run the Django test suite
invoke test
```

## Common Development Commands

```bash
# Process orchestration
devenv up             # Start postgres, redis, mailpit, django, apiworker, celery

# Django commands (inside `devenv shell`)
invoke migrate        # Run database migrations
invoke makemigrations # Create new migrations
invoke shell          # Django shell
invoke test           # Run tests
invoke collectstatic  # Collect static files
invoke compilescss    # Compile SCSS files
invoke seed-minimal   # Fill the database with some simulated values

# Dependencies
invoke update         # Update all dependencies via Poetry
```

## Configuration

All configuration is done through environment variables. The `.env.dev` file contains defaults for local development.

Key settings:

- Database: PostgreSQL on localhost:5432
- Redis: localhost:6379
- Email: Mailpit on localhost:1025 (SMTP) / 8025 (Web UI)
- Static files: SCSS compilation via Ruby sass gem (auto-installed in devenv shell)

## Development Tips

- The devenv shell automatically installs all required tools including Python 3.11, Poetry, Ruby, and sass
- Virtual environment is created automatically when entering the devenv shell (via `languages.python.poetry`)
- Ensure that your editor has an [EditorConfig plugin](https://editorconfig.org/#download) enabled
- JaVaFo pairing tool is included in `thirdparty/javafo.jar`

## Stopping Services

`Ctrl-C` in the `devenv up` window stops everything. Service state (Postgres data, Redis AOF, Mailpit storage) lives in `.devenv/state/` and persists between runs. Delete that directory to start from scratch.

## Historical Note

This project was previously known as heltour and served lichess4545. It has been rebranded to support lots.lichess.ca (Lichess Online Tournament System).

.
