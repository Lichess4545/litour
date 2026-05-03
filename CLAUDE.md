# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Litour (formerly heltour) is a Django + FastAPI tournament-management
app for online chess events, branded as **Palamedes**. Backend:
Django 4.2 / Python 3.11 / PostgreSQL 15 / Celery+Redis / FastAPI for
the new API surface. Frontend: a Next.js + shadcn UI alongside the
legacy jQuery + Bootstrap templates. Detailed dev setup, services, and
invoke commands live in [`design/development.md`](design/development.md).

## Architecture rules (apply to all new code)

These are non-negotiable for new features:

1. **Screaming architecture.** Top-level folders name chess concepts,
   not technical layers. The six domains are `event_setup`,
   `registration`, `roster_formation`, `round_management`,
   `standings`, and `discovery`. See [`design/architecture.md`](design/architecture.md)
   for the FastAPI layout, frontend layout, and which concepts live in
   which domain.
2. **Simple DI for testability only.** Constructor / property
   injection of a callable or small object, with a sensible default.
   No DI frameworks, registries, or service locators. Skip it when it
   doesn't actually help a test.
3. **Integration tests where possible.** Cover the wiring between
   layers (FastAPI `TestClient`, real DB) — sync-service unit tests
   stay for speed and N+1 guards, but at least one integration test per
   domain.
4. **Frontend four-layer separation.** `components/ui/` (shadcn raw)
   → `components/primitives/` (styled, generic) →
   `components/<domain>/` (chess logic) → `app/...` (page composition).
   Don't edit `components/ui/`.
5. **Permissions are checked at four tiers.** endpoint, type, instance,
   field. The websocket and HTTP layers share the same predicates; the
   API is the single boundary. See `heltour/api/shared/permissions.py`.
6. **Every page is real-time.** Browsers connect a websocket on every
   page; design new APIs assuming streamed updates carry full DTOs and
   the UI replaces state with the payload.

## Code style

- **Python**: ruff for formatting + linting. 4-space indent, max 100
  chars/line.
- **TypeScript**: biome for formatting + linting. 2-space indent.
- HTML/SCSS: 4-space indent.
- UTF-8, LF line endings. See `.editorconfig`.

Strict TypeScript: no explicit or implicit `any`, no type casts (use
zod or proper narrowing); `as const` is fine.

## Testing

- Django tests live in `heltour/tournament/tests/` (legacy) and per
  domain in `heltour/api/<domain>/tests/`.
- Pure-Python tournament logic tests live in
  `heltour/tournament_core/tests/`.
- For tournament-shaped tests, use `TournamentBuilder` and the fluent
  `assert_tournament(...)` interface — see
  [`design/tournament-core.md`](design/tournament-core.md).

## Important Instructions for Claude

### Command execution policy

- **Do not** run any commands — the user runs all commands themselves.
- **Do not** use `devenv shell`, `invoke`, `poetry`, `npm`, `bun`, or
  any shell command to start servers, run tests, or execute dev tasks.
- Read, analyze, write, and edit files. Suggest commands when asked.

### Testing policy

- **Never** run tests. Suggest the command if relevant.

### Git policy

- **Never** execute git commands — only read git info already provided
  in the environment.

### Migrations policy

- **Never** create Django migration files manually or run
  `makemigrations` / `migrate`. Don't write into migration directories.
  When models change, tell the user to run `makemigrations`.

### General

- Don't create new files unless the task requires it.
- Respect existing code structure and patterns.
- Ask for clarification before assuming.

## Deferred work

[`TODOS.md`](TODOS.md) tracks deferred follow-up work captured during
planning — each entry has the context, trigger, and dependencies
needed to pick it up later.

## Historical context

The project was originally `heltour` for lichess4545 and was rebranded
to Litour (public name: Palamedes). The `heltour` name still appears in
many places for backwards compatibility — that's expected.

## Design System

Always read [`DESIGN.md`](DESIGN.md) before making any visual or UI
decisions. All font choices, colors, spacing, and aesthetic direction
are defined there. Do not deviate without explicit user approval. In
QA / review mode, flag any code that doesn't match DESIGN.md.

## gstack

Use the `/browse` skill from gstack for **all** web browsing. **Never**
use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`,
`/plan-eng-review`, `/plan-design-review`, `/design-consultation`,
`/design-shotgun`, `/design-html`, `/review`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`,
`/connect-chrome`, `/qa`, `/qa-only`, `/design-review`,
`/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`,
`/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`,
`/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`,
`/unfreeze`, `/gstack-upgrade`, `/learn`.
