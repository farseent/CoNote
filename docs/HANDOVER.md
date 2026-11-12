# CoNote – Handover

**Last updated:** 2026-11-12
**Current phase:** Phase 1 – Project Setup and Infrastructure. **Phase 1a (infrastructure) implemented; Phase 1b (collaboration spike) NOT done** (D33). Awaiting owner review.
**Next phase:** Phase 2 – Authentication and User Management (**not started; do not start without the owner's approval**). The collaboration spike (Phase 1b) is an owner decision: run it before Phase 2 or later (recommended: before Phase 5).

Read `CLAUDE.md` first. This file is the single place for current status; other documents describe the design.

## 1. Status summary

| Item | Status |
|---|---|
| Application code | Foundations only: `apps/web|api|collab` shells, `packages/shared|db|editor`. **No product feature exists** (no auth, models, editor, collaboration) |
| Local verification (2026-11-12, sandbox) | `lint`, `format:check`, `typecheck`, `pnpm install --frozen-lockfile`, `pnpm build` exit 0; 59 tests pass (47 unit, 12 integration against real PostgreSQL 17.11 and Redis 7.0.15). Details in §3 |
| **Not verified by Claude** | `prisma migrate deploy` (Prisma schema engine could not be downloaded in the sandbox), Docker Compose and Docker image builds (no Docker in the sandbox), GitHub Actions run, PostgreSQL via the official `postgres:17-alpine` image. **The owner must run these (§3)** |
| Phase 1b spike (S1–S11, AC-1.8–1.10) | Not done; U3, U4, V1–V6, V11–V14 remain unresolved |
| Decisions added in Phase 1 | D33–D40 (Proposed) in `docs/DECISIONS.md` |
| Owner-approved decisions | D1–D10 (explicit approval), D28 (roadmap structure) |
| Proposed decisions awaiting sign-off | D15–D27, D29–D32, D33–D40 |
| Next action | Owner runs the checks in §3.4, reviews, decides on Phase 1b, then approves Phase 2 |

## 2. Phase 0 record (historical)

### 2.1 Phase 0 work completed

| Deliverable | File | Notes |
|---|---|---|
| Permanent instructions | `CLAUDE.md` | Rules for every future chat |
| Project description | `README.md` | Planned design only; no implemented features claimed |
| Project master | `docs/PROJECT_MASTER.md` | 62 functional requirements, NFRs, PERF metric definitions, permission matrix, stack with verified candidate versions |
| Architecture | `docs/ARCHITECTURE.md` | Components, module boundaries, Yjs lifecycle, persistence design, guarantees G1–G7, failure modes, 3 Mermaid diagrams |
| Database | `docs/DATABASE_SCHEMA.md` | Complete Prisma design (17 models), SQL constraints, cascades, persistence/recovery detail, ER diagram |
| REST API | `docs/API_CONTRACTS.md` | 53 endpoints with auth, authz, requests, responses, validation and errors; envelope and error codes |
| WebSocket | `docs/WEBSOCKET_PROTOCOL.md` | Connection, auth, sync, awareness, application messages, restore procedure, reconnection, cross-instance behaviour |
| Decisions | `docs/DECISIONS.md` | 32 decisions with permanent IDs, 12 unresolved items |
| Roadmap | `docs/IMPLEMENTATION_PLAN.md` | Phases 0–11 with 111 numbered acceptance criteria |
| Testing | `docs/TESTING.md` | Categories, guarantee verification, metric measurement methods, traceability |
| Deployment | `docs/DEPLOYMENT.md` | Provider-neutral topology, configuration, operations, runbooks |
| Handover | `docs/HANDOVER.md` | This file |

Research performed (2026-11-11): Hocuspocus, y-websocket and y-redis documentation; Tiptap collaboration docs; Prisma requirements and supported databases; Node.js lifecycle; npm registry engine and peer-dependency metadata for the planned packages.

### 2.2 Key architectural conclusions

1. **y-websocket + Redis is not a scalable architecture** by itself; the reference server is in-memory and its README says it cannot be scaled easily. **Hocuspocus + its Redis extension** is the approved choice (D1, D2). The Redis extension does not persist data and every instance handles every message, so it adds availability and connection capacity, not per-document CPU capacity.
2. **Persistence design (D15):** append-only diff updates, compacted state, immutable snapshots; all writes per page under a row lock; PostgreSQL is the only durable store (D14). Guarantees are limited to **G1–G7**; zero data loss is never claimed. Redis Pub/Sub misses are not replayed; an explicit Phase 9 recovery path is required before live reconvergence can be claimed.
3. **Package findings:** Prisma CLI `latest` is an 8.x release candidate while the client is 7.10.1 → both pinned to 7.10.1 (D18); Hocuspocus Redis extension depends on ioredis 5.6 → pinned 5.6.x (D19); Tiptap 3 Collaboration needs `@tiptap/y-tiptap` (D20); TypeScript `latest` is 7.x but the toolchain was not verified against it → 5.9.3 (D17); Node 24 is already in Maintenance LTS and Node 26 is only weeks into LTS → Node 24 proposed (D16, U1).
4. **Design choices made during Phase 0 that go beyond your explicit approvals** (all Proposed; please review): collaboration JWT signed with EdDSA so collab holds public keys only (D22); permission resolution rules and Admin limits (D23); soft delete with 30-day purge (D24); version create/restore as WebSocket commands, list/read as REST (D32); awareness identity binding; no workspace-level realtime channel in the MVP (D32); link-based invitations with the token in the URL fragment (D30).

### 2.3 Decisions needing owner sign-off

Approved decisions (D1–D10, D28) and requirement-derived decisions (D11–D14) are final unless you change them. The following are **Proposed** and are the working plan unless you object:

| ID | Decision | Where it matters |
|---|---|---|
| D15 | Yjs persistence model (diff append + compaction + snapshots) | Phases 5–6 |
| D16 | Node.js 24 LTS | Phase 1 |
| D17 | TypeScript 5.9.x | Phase 1 |
| D18 | Prisma 7.10.x (no 8 RC) | Phase 1 |
| D19 | ioredis 5.6.x | Phases 2, 6 |
| D20 | Tiptap 3.x + Yjs 13.x + `@tiptap/y-tiptap` | Phases 4–5 |
| D21 | Collab server accesses PostgreSQL directly | Phase 6 |
| D22 | Collaboration JWT format, revalidation, revocation | Phase 6 |
| D23 | Roles and effective-permission resolution | Phase 3 |
| D24 | Soft delete for pages | Phase 3 |
| D25 | API security baseline | Phase 2 |
| D26 | Testing toolchain | Phase 1 |
| D27 | Next.js 16, React 19, Tailwind 4 | Phase 1 |
| D29 | UUID identifiers | Phase 2 |
| D30 | Invitation token handling | Phase 3 |
| D31 | API versioning and envelope | Phase 2 |
| D32 | Application-level realtime events (stateless messages) | Phases 6, 8 |

### 2.4 Unresolved decisions

| ID | Question | Needed by |
|---|---|---|
| U1 | Node.js 24 or 26 | Phase 1 start |
| U2 | TypeScript 5.9.3 or newer | Phase 1 |
| U3 | Hocuspocus store-hook/Redis persistence behaviour | Phase 1 spike |
| U4 | Awareness semantics across instances and from read-only connections | Phase 1 spike |
| U5 | Prisma 7 monorepo setup details | Phase 1 |
| U6 | Invitation email provider (link-based invitations ship first) | Phase 3 / Phase 11 |
| U7 | Image upload flow, limits, MinIO status | Phase 4 |
| U8 | Comment anchors after version restore (recommendation: mark detached) | Phase 8 |
| U9 | External guests (recommendation: out of scope) | Phase 3 |
| U10 | Production hosting target | Phase 11 |
| U11 | Retention for AUTO snapshots and activity logs | Phase 8 / 10 |
| U12 | Repository license and visibility | Before publishing |
| U13 | Explicit Phase 9 recovery mechanism for Redis Pub/Sub message loss | Phase 9 |

Full options and recommendations are in `docs/DECISIONS.md`.

### 2.5 Unverified assumptions (V1–V14)

Tracked in `docs/ARCHITECTURE.md` §18. The Phase 1 spike is designed to resolve V1–V6, V11–V14 (store-on-unload and debounce options, store hook for Redis-originated updates, awareness behaviour, Redis outage detection/recovery feasibility, token handling, close codes, stateless messages, awareness identity enforcement, limits). Redis reconnection alone is not accepted as proof of reconvergence. V7 (Next.js rewrite forwarding) is Phase 2; V8 (Prisma monorepo setup) Phase 1; V9 (Yjs binding package) Phase 5; V10 (server-side restore transaction) Phase 8. **Do not treat any V item as fact until it is verified and the docs are updated.**

### 2.6 Documentation corrections prepared in Phase 0

The following design defects were corrected in the Phase 0 document set. These are documentation changes only; no implementation or tests have been run.

1. **Redis outage:** G5 no longer promises automatic reconvergence after Redis returns. Redis Pub/Sub message loss is explicit; Phase 9 must implement and test stale-document detection and resynchronization. Added U13.
2. **Workspace owner invariant:** clarified that the partial unique index enforces at most one owner only. A deferred PostgreSQL constraint trigger is required to enforce at least one owner at commit; create/transfer must be atomic.
3. **Readiness:** API liveness/readiness, PostgreSQL health and Redis degraded status are separate. Redis alone does not make the API unready; Redis-dependent operations have explicit scoped failure/fallback rules.
4. **Page tree concurrency:** structural mutations serialize on a workspace-scoped transaction lock; a composite `(workspaceId,parentId)` foreign key prevents cross-workspace parent links; race tests cover cycles and concurrent moves.
5. **Version restore:** Phase 8 requires a durable cross-instance restore barrier, draining/committing pre-barrier updates, PRE_RESTORE snapshot before applying restore, atomic failure behaviour and client resynchronization.

### 2.7 Consistency review (performed at the end of Phase 0)

**Previous checks run before the corrections below; rerun after merging the corrected documents.**

| Check | Result |
|---|---|
| Every referenced ID is defined | Previously checked; rerun after corrections |
| Decision index matches decision bodies (D1–D32); unresolved register includes U13 | Pending rerun after corrections |
| Acceptance criteria ids unique (111) | Previously checked; rerun after corrections |
| Cross-document and intra-document section references resolve | Previously checked; rerun after corrections |
| Key values consistent across documents | Previously checked; rerun after corrections |
| Every one of 53 endpoints and 62 functional requirements is covered by a phase in the plan | Pass |
| Mermaid diagrams parse with Mermaid 11 | Previously checked; rerun after corrections |

**Defects found and fixed during the review**

1. `ARCHITECTURE.md` was missing the two sequence diagrams I had described in the first delivery batch; they were added (§11.1, §11.2) and validated.
2. `DECISIONS.md` D15 described `DocumentState` as holding "its state vector"; corrected to the persisted-vector definition used in the schema and architecture.
3. After the schema/API batch: Admin role-management limits added to the permission matrix and D23; D32 extended with client-to-server commands; `DocumentState` wording, image URL form, version create/restore path and V12–V14 added to the architecture; FR-AUTH-05 phase annotation (avatar in Phase 4); U11 and U12 added; D27 referenced in the stack table.

**Limits of this review (what it does not prove)**

- The checks verify references, numbers and syntax. They do not prove the design is correct; the Phase 1 spike and later tests do.
- Mermaid validation checks syntax parsing, not visual rendering.
- Package versions come from registry metadata (engines/peer dependencies) read on 2026-11-11; nothing was installed or run together.
- Several documentation URLs are listed as "not fetched during Phase 0" in the references.
- Node.js lifecycle dates came from third-party aggregators of the official schedule; confirm on nodejs.org when deciding U1.
- No effort or time estimates were produced; the roadmap's achievability was checked structurally (acyclic dependencies, full coverage of requirements and endpoints, spike before dependent work), not by schedule.

**Known soft spots to be aware of**

- Environment variable and Hocuspocus option names are provisional (confirmed in Phases 1 and 6).
- `@tiptap/y-tiptap` is given as a range requirement; its exact pin is chosen in Phase 1.
- The Prisma schema's generator/datasource configuration is a placeholder until U5.
- Access-event handling for page moves that change inherited access falls back to full revalidation; the precise recomputation strategy is a Phase 6 detail.
- `PAGE-02` returns the whole accessible tree unpaginated; revisit with Phase 9 measurements.
- CI provider (GitHub Actions) and GitHub hosting are assumptions.

## 3. Phase 1 (infrastructure) – results

### 3.1 What was built

- **Monorepo:** pnpm 12.18.0 workspace (`apps/*`, `packages/*`), Node 24 (`.nvmrc`, `engines`, `engine-strict`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, NodeNext), exact version pins (`.npmrc` `save-exact`), docs moved under `docs/`.
- **web:** Next.js 16.4.6, React 19.3.1, Tailwind 4.3.5; starter page; `GET /health`; env validated at server start (`instrumentation.ts`). Standalone output only when `NEXT_OUTPUT=standalone` (Docker image).
- **api:** Fastify 5.12.8; pino JSON logging with redaction; request ids (`X-Request-Id`, accepted only if safe); error envelope (D31) with no leaking of internals; `GET /health` (OPS-01), `GET /ready` (OPS-02); graceful SIGTERM/SIGINT shutdown.
- **collab:** Hocuspocus 4.8.0 shell; HTTP `/health` and `/ready`; accepts the WebSocket handshake but **rejects every document connection** (D38); graceful shutdown.
- **db:** Prisma 7.10.1 with `@prisma/adapter-pg`, generator `prisma-client` output `packages/db/src/generated/prisma` (git-ignored, generated by `build`/`typecheck`), `prisma.config.ts` reading `DATABASE_URL` from the environment, no models, one empty baseline migration (D35); `checkDatabase()` health check.
- **shared:** Zod env schemas + `parseEnv`, error-code catalog and `AppError`, response envelope helpers, health types and readiness rules, logging constants. Pure: no I/O, no repository imports (lint-enforced).
- **editor:** empty entry point.
- **Tooling:** ESLint 10 flat config with module-boundary rules (D39), Prettier, Vitest 5.1.0 with `unit` and `integration` projects, GitHub Actions CI (`.github/workflows/ci.yml`), `.env.example`, Docker Compose (`postgres:17-alpine`, `redis:7-alpine`; optional `apps` profile with Dockerfiles), `pnpm bootstrap` script.

### 3.2 Acceptance criteria (Phase 1a)

Your 16-task list and the plan's AC-1.x are both reported. "Verified" means executed in the sandbox on 2026-11-12.

| Criterion | Result | Evidence / caveat |
|---|---|---|
| Frontend starts | Verified | `next start` served `/` (200) and `/health`; fails fast with a named-variable error when `APP_URL`/`API_INTERNAL_URL` are missing |
| Backend starts | Verified | Compiled and `pnpm deploy`-ed API served `/health`, `/ready`, standard 404 envelope; real-process integration test starts it via tsx and shuts it down with exit 0 |
| WebSocket server starts | Verified | Collab test: handshake accepted; process started from `dist` and from tsx; `onConnect` rejects every document connection |
| PostgreSQL connection works | Verified (PostgreSQL 17.11 binary from npm, not the Docker image) | `/ready` healthy; unreachable DB gives `503`/`unavailable` without leaking the URL |
| Prisma connects | Verified | `prisma generate` and a real query through `@prisma/adapter-pg` in the db integration tests |
| **Migrations run** | **NOT verified** | `prisma migrate deploy` needs the schema-engine binary from `binaries.prisma.sh`, which the sandbox blocks. In the sandbox the baseline was applied manually (`_prisma_migrations` row written by a script, not committed) so the readiness tests could run. **Run `pnpm db:migrate:deploy` yourself; CI also runs it** |
| Redis connection works | Verified (Redis 7.0.15 from apt, not the Docker image) | `/ready` healthy; unreachable Redis: API stays `ready` (200) with redis `unavailable`, collab reports `degraded` |
| Docker Compose starts required services | **NOT verified** | No Docker in the sandbox. `docker-compose.yml` is YAML-valid only. **Run `pnpm infra:up`** |
| Docker images build | **NOT verified** | The `pnpm deploy` step used by `Dockerfile.node` was run locally and the result started; the Dockerfiles themselves were never built |
| Linting and formatting work | Verified | `pnpm lint`, `pnpm format:check` exit 0 |
| Tests execute | Verified | 59 passed (9 files): 47 unit + 12 integration |
| Production build succeeds | Verified | `pnpm build` exit 0 (packages, api, collab, web). Standalone variant also builds |
| CI workflow configured | Configured, **not run** | Valid YAML; never executed on GitHub. Needs a first run |
| AC-1.1 frozen-lockfile install | Verified locally | `pnpm install --frozen-lockfile` exit 0; CI not yet run |
| AC-1.3 boundary lint test | Verified | 13 deliberate violations fail, 4 allowed imports pass (`tests/boundaries.test.ts`) |
| AC-1.4 compose incl. object storage | Not met | No Docker; object storage deliberately omitted (D37) |
| AC-1.5 shells + readiness semantics | Verified | Unit tests (fake dependencies) and integration tests (real services) cover each dependency independently |
| AC-1.6 pins match PROJECT_MASTER §6 | Verified for installed packages | Playwright, Tiptap, auth and S3 packages are not installed yet (arrive with their phases). Extra pins in D39 |
| AC-1.7 Prisma generates and connects | Partly | Generates and connects (verified); `migrate deploy` unverified (above). U5/V8 not marked resolved |
| AC-1.8 – AC-1.10 spike | Not done | Phase 1b (D33) |
| AC-1.11 no production collaboration code | Met | No spike directory was created; collab only rejects connections |

### 3.3 Sandbox-only workarounds (not in the repository)

- `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` exported so `prisma generate` would not try to download the engine. **Not needed on a normal machine or in CI**.
- Node 24 and PostgreSQL 17 binaries were fetched from npm packages; Redis from apt.
- Baseline migration bookkeeping applied by a script instead of `prisma migrate deploy`.

### 3.4 Things you must run (in order)

1. `pnpm bootstrap` (or: `cp .env.example .env`, `pnpm install`, `pnpm infra:up`, `pnpm build:packages`, `pnpm db:migrate:deploy`). Confirm migrations apply and `pnpm db:migrate:status` is clean.
2. `pnpm check`, then `pnpm dev:api`, `pnpm dev:collab`, `pnpm dev:web` and open `/health` and `/ready`.
3. `docker compose -f infra/docker-compose.yml --profile apps up --build` to test the Dockerfiles.
4. Push to GitHub and confirm the CI workflow passes (first run may need fixes, e.g. `pnpm/action-setup` with pnpm 12).

### 3.5 Known limitations and soft spots

- Readiness "schema-compatible" only checks for failed migrations (D35).
- `redis.ts`, `logger.ts` and `dependencies.ts` are duplicated between `apps/api` and `apps/collab`. Consolidate if a third consumer appears; do not move I/O into `packages/shared`.
- Fastify logs the request id as `reqId` (default) rather than `requestId`.
- Unauthenticated WebSocket handshakes stay open until Hocuspocus' own timeout; acceptable only because Phase 1 is not exposed. Phase 6 must add origin/auth checks.
- Integration tests assume migrations are applied and use whatever `DATABASE_URL` points to (a scratch database is created and dropped only in the schema-compatibility test).
- Playwright is not configured yet.
- Pin policy: pnpm 12's release-age gate blocked Prettier 3.10.0 (D39). Re-check the gate whenever versions are bumped.

## 4. Instructions for the next chat

**Phase 2 may start only after the owner approves.** Phase 1b (spike) is optional before Phase 2 (D33).

### Files to give the Phase 2 chat

Docs: `CLAUDE.md`; `docs/HANDOVER.md`; `docs/IMPLEMENTATION_PLAN.md` (Phase 2 and §1 Definition of Done); `docs/PROJECT_MASTER.md` (FR-AUTH, security NFRs, §6 pins); `docs/ARCHITECTURE.md` (module boundaries §5, session/cookie design §4); `docs/DATABASE_SCHEMA.md` (`User`, `Session`); `docs/API_CONTRACTS.md` (conventions, `AUTH-*`, `USER-*`, envelope, error codes); `docs/DECISIONS.md` (D5, D6, D25, D29, D31, D33–D40); `docs/TESTING.md`; `docs/DEPLOYMENT.md` (§4 configuration).

Code Phase 2 will change or build on: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.env.example`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig.base.json`, `.github/workflows/ci.yml`; `packages/shared/src/*`; `packages/db/` (`prisma/`, `prisma.config.ts`, `src/*`, `package.json`); `apps/api/` (`src/*`, `test/*`, `package.json`); `apps/web/` (`next.config.ts`, `src/*`, `package.json`, `tsconfig.json`); `tests/helpers.ts`.

Not needed for Phase 2: `apps/collab`, `packages/editor`, `infra/` Dockerfiles, `scripts/`, `docs/WEBSOCKET_PROTOCOL.md`. Easiest is to upload the repository as a zip **without** `node_modules`, `.next`, `dist` and `.env`.

### First steps for Phase 2

1. Run §3.4 and fix anything it reveals; get the owner's go-ahead on D33–D40 and on U1/U2.
2. Add `User` and `Session` models and the first real migration; extend readiness compatibility (D35).
3. Follow `docs/IMPLEMENTATION_PLAN.md` Phase 2 (AC-2.1 … AC-2.12). Add Phase 2 environment variables with their code (D40), add `argon2` to `allowBuilds` in `pnpm-workspace.yaml`, and configure Playwright for the E2E criterion.

## 5. Change log

| Date | Change |
|---|---|
| 2026-11-11 | Phase 0 documentation created in four batches; initial consistency review performed; this handover written. |
| 2026-11-11 | Corrected Redis outage/recovery, owner invariant, readiness, page-tree concurrency and version-restore design; awaiting owner review. |
| 2026-11-12 | Phase 1a infrastructure implemented (monorepo, shells, Prisma, Redis, Compose, CI, tests); decisions D33–D40 added; spike deferred (Phase 1b); several checks not verifiable in the sandbox (§3). |
