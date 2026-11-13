# CoNote – Testing Strategy

**Status:** Phase 1a test foundation (reported passing by the owner: 9 files, 59 tests) plus **Phase 2 authentication tests, run by Claude in a preparation environment: 17 files, 228 tests passed (115 unit + 113 integration), twice in a row** (§8.0a). The Phase 1b spike harness is under `spikes/collab-poc/`. Tests for workspaces, pages, editing and collaboration do not exist yet. **Browser E2E (Playwright) is not implemented.**
**Last updated:** 2026-11-13

Decision IDs (`D#`, `U#`) are in [DECISIONS.md](DECISIONS.md); requirements and metrics (`FR-*`, `NFR-*`, `PERF-*`) in [PROJECT_MASTER.md](PROJECT_MASTER.md); guarantees `G1`–`G7` in [ARCHITECTURE.md](ARCHITECTURE.md) §8; phases and acceptance criteria (`AC-*`) in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Principles

1. **Tests are evidence.** A feature or guarantee is "done" only when named tests pass. Documentation must not claim more than the tests show (D14).
2. **No invented results.** This document defines *how* to measure. It contains no measured values, targets or expected numbers. Results are recorded only after they are measured, together with the environment (§10).
3. **Test at the right level.** Pure logic in unit tests; real PostgreSQL/Redis for integration and database tests (no mocking of the database for persistence or permission queries); real WebSocket servers for collaboration tests.
4. **Deterministic by default.** Randomized tests use a logged seed; time is controllable; failures must be reproducible from the log.
5. **Security and permissions are tested as first-class behaviour**, from both REST and WebSocket.
6. **Every phase ships its tests** (Definition of Done, IMPLEMENTATION_PLAN §1).

## 2. Tooling (D26)

| Purpose | Tool |
|---|---|
| Unit, integration, API, database, WebSocket tests | Vitest 5.1.0 |
| Multi-browser and end-to-end tests | Playwright 1.65.0 (Chromium, Firefox, WebKit) |
| Collaboration, reconnection, recovery and load tests | Custom **Node.js Yjs client harness** (headless clients using `yjs`, `y-protocols`, `@hocuspocus/provider`) driven from Vitest or standalone scripts |
| HTTP API tests | Fastify's in-process `inject` where possible; real HTTP through the Next.js rewrite for proxy/cookie tests |
| Infrastructure | Docker Compose services: PostgreSQL 17, Redis 7.x, S3-compatible storage |
| Static checks | ESLint (module boundaries, ARCHITECTURE §5), TypeScript strict |

Versions are exact pins (D13); changes follow DECISIONS.md.

## 3. Test categories

Each category has an abbreviation used throughout the plan and in test names/ids. Test ids follow `<CAT>-<AREA>-<nn>` (e.g. `PERM-PAGE-07`) and are assigned when a test is written.

| Cat. | Name | What it covers | Real dependencies | Runs |
|---|---|---|---|---|
| `UT` | Unit | Pure functions: permission resolution, validation schemas, token claims, Yjs utilities, hashing helpers | none | every PR |
| `IT` | Integration | Several modules together: services with a real DB, proxy path, job runners, document store with Redis events | PostgreSQL, Redis | every PR |
| `API` | API | Every REST endpoint: success, each documented error code, validation, authentication, authorization, envelope shape | PostgreSQL, Redis, storage | every PR |
| `DB` | Database | Constraints, partial unique indexes, cascades, row locking under parallel transactions, migrations from scratch and from the previous migration | PostgreSQL | every PR |
| `WS` | WebSocket | Connection, authentication hook, read-only enforcement, application messages, close reasons, abuse handling | collab server, PostgreSQL, Redis | every PR |
| `CE` | Concurrent editing | Convergence of many replicas under randomized concurrent edits, delivery reordering, duplication and offline periods | collab server (and in-process Y.Docs), PostgreSQL | short seeds every PR; long seeds nightly |
| `MB` | Multi-browser | Two or more real browsers/contexts collaborating through the UI | full stack | nightly; smoke subset per PR |
| `PERM` | Permission | Role × action × resource matrix over REST and WebSocket, inheritance, revocation | full stack | every PR |
| `RECON` | Reconnection | Network drops, token refresh, offline edits merging, instance switch | collab, proxy to simulate drops | nightly; subset per PR |
| `REC` | Recovery | Process kill and restart, compaction fault injection, backup/restore | collab, PostgreSQL | nightly; subset per PR |
| `LOAD` | Load | Performance and capacity measurement (PERF-01 … PERF-07) | multi-instance stack | on demand, before release |
| `E2E` | End-to-end | User journeys through the browser | full stack | every PR (smoke), nightly (full) |
| `SEC` | Security | Authentication, session, cookie, CSRF, token, upload, injection and abuse tests | full stack | every PR (fast), pre-release (full) |
| `GT` | Guarantee | Tests that specifically evidence G1–G7 (tagged subset of the above) | as needed | every PR / nightly |

## 4. Environments and test data

- **Isolation:** each Vitest worker uses its own PostgreSQL database (created from a migrated template) and its own Redis key prefix or database number. Tests never share mutable state.
- **Time:** services accept an injectable clock; session expiry, invitation expiry, throttles and revalidation are tested with a controlled clock, not real waiting.
- **Fixtures:** factories create users, workspaces, members of each role, page trees and permission overrides. A seed script (Phase 3) builds the dev dataset; tests do not depend on it.
- **Secrets:** tests use throw-away keys (an Ed25519 pair generated per run); no real credentials; nothing is committed.
- **Browsers:** Playwright uses separate browser contexts for separate users (isolated cookies and storage).
- **Network faults:** a TCP/WebSocket fault-injection proxy (written for the harness) sits between clients and the collab server to drop, delay or sever connections deterministically.
- **Process faults:** the harness starts/kills collab processes directly to test crashes and restarts.

## 5. Test design by area

### 5.1 Unit tests (`UT`)

- **Permission resolution (D23):** exhaustive table over workspace role × page override × inheritance depth; `NONE` denies; Admin/Owner cannot be restricted; non-members denied; deleted-page handling.
- **Validation:** each Zod schema accepts valid and rejects invalid inputs, unknown fields rejected.
- **Token logic:** collaboration-token claims, expiry, audience, key selection by `kid`.
- **Yjs utilities:** diff computation against a persisted vector, per-client maximum vector merge, empty-document handling.
- **Fractional-index `position`** generation (ordering and insertion between siblings).

### 5.2 Database tests (`DB`)

- Every SQL constraint in DATABASE_SCHEMA §5 is tested for acceptance and rejection. Owner invariant tests cover both at-most-one (partial unique index) and at-least-one (deferred constraint trigger), including create, transfer, member removal, rollback and direct SQL attempts to commit a workspace with zero owners.
- Cascade behaviour per DATABASE_SCHEMA §8 (workspace → pages → document data → comments; user deletion nulling references).
- **Document locking:** parallel stores on the same page serialize and lose no data; stores for different pages do not block each other. **Workspace tree locking:** concurrent moves/create/delete/restore operations serialize on the workspace-tree advisory lock; tests attempt opposing moves that would create a cycle, simultaneous cross-workspace moves and depth-limit races. The composite parent FK rejects cross-workspace parent references even when service validation is bypassed.
- Migrations: apply from scratch; apply on top of the previous release's schema.

### 5.3 API tests (`API`)

For each endpoint id in API_CONTRACTS.md: success path; each documented error code; missing authentication; insufficient role (`403`) vs no access (`404`); validation failures; envelope shape; pagination where applicable; rate-limit behaviour on limited endpoints. Side effects are asserted (activity entries, Redis events published, DB rows).

### 5.4 WebSocket tests (`WS`)

- Authentication: valid token; expired; bad signature; wrong `aud`/`iss`; `pid` mismatch; token for a different page; deleted page; revoked session; JWT `alg` confusion (`none`, HS256 with the public key as secret) rejected.
- Authorization: Viewer/Commenter read-only (updates ignored: verified through other clients and the database); Editor read-write.
- Application messages: schema validation, unknown type/version, command authorization, correlation (`replyTo`), `CONFLICT` on concurrent restore.
- Close reasons and codes as in WEBSOCKET_PROTOCOL §9/§11.
- Abuse: malformed Yjs updates, oversized messages, awareness floods, too many connections.

### 5.5 Concurrent editing tests (`CE`)

**Randomized convergence test design**

1. A seeded PRNG chooses a number of replicas (clients and, where relevant, server documents) and a sequence of operations per replica.
2. Operations on headless Tiptap/ProseMirror editors bound to `Y.Doc`s: insert text at random positions, delete ranges, toggle marks, split/merge blocks, insert/remove list items and table rows. A simpler `Y.Text`-level variant runs faster for large iteration counts.
3. The delivery network is simulated: updates are delayed, reordered, duplicated and withheld during simulated offline periods, then delivered.
4. After quiescence all replicas are compared: equal **state vectors** and equal **document JSON** (and equal persisted content after a store).
5. On failure, the test prints the seed and the minimal reproducing operation log (shrinking is attempted).

Variants: in-process replicas (fast, many iterations); through the real collab server with N clients; with a mid-run server restart; with simultaneous restore (Phase 8); with multiple instances (Phase 9). Redis outage tests must disconnect one instance, publish updates from the other, reconnect Redis, and prove the selected recovery mechanism detects and repairs stale state; a Redis restart alone is not a passing reconvergence test.

### 5.6 Multi-browser tests (`MB`)

Playwright launches two or more contexts (different users) on Chromium, Firefox and WebKit: concurrent typing, caret/selection visibility, presence list, comments appearing live, version restore seen by all. Waits use explicit conditions with a generous timeout, never fixed sleeps. These tests assert **convergence and visibility**, not latency (latency is measured only in `LOAD`).

### 5.7 Permission tests (`PERM`)

- The permission matrix (PROJECT_MASTER §5) is encoded once as test data (in `packages/shared` test fixtures) and drives generated tests: for every role, action and resource, expect allowed or denied over **REST**, and for editing/commenting over **WebSocket**.
- Additional cases: page override `NONE`; override on an ancestor; moving a page changes inherited access; Admin/Owner cannot be restricted; removing a member deletes overrides; ownership transfer.
- **Revocation tests:** member removal, role downgrade, session revocation, page deletion and permission change take effect on open connections via events, and via periodic revalidation when events are suppressed (G6). The observed delay is recorded.

### 5.8 Reconnection tests (`RECON`)

Drop the network (fault-injection proxy) for varying durations while one or more clients edit; verify new token acquisition on reconnect, re-sync, merged offline edits, correct behaviour when the token endpoint returns `401`/`404`, reconnect to a different instance, and the unsynced-changes warning state.

### 5.9 Recovery tests (`REC`)

- **Kill points:** kill the collab process (a) before any store, (b) between debounce store cycles, (c) during a store transaction, (d) during compaction (fault injection); restart; verify content equals the last **committed** state (G2, G3, G4).
- **Surviving client:** with a client that stays open, unsynced edits are re-sent after reconnect; **without** a surviving client the lost edits are exactly those after the last commit. The test records which edits were lost; this documents G3 honestly rather than hiding it.
- **Compaction fault injection:** failure mid-compaction leaves the previous state and rows intact (G4).
- **Backup and restore (Phase 11):** restore PostgreSQL into a fresh database; verify application data and collaborative documents; record restore time.

### 5.10 Load tests (`LOAD`)

Scenarios (profiles are defined in a run plan before each run; stop criteria are set in the plan, not guessed here):

| ID | Scenario | Primary metrics |
|---|---|---|
| L1 | Many documents, few clients each (typical usage) | PERF-02, PERF-07 |
| L2 | One hot document, many clients editing | PERF-01, PERF-03 |
| L3 | Reconnect storm (many clients reconnect at once, including after an instance restart) | PERF-04, PERF-06 |
| L4 | Large document with many stored updates: load time and compaction | PERF-06, PERF-05 |
| L5 | Sustained write load: persistence lag and PostgreSQL behaviour | PERF-05 |
| L6 | Multi-instance fan-out (2 and 3 instances): Redis message rate, CPU effect of "all instances handle all messages" | PERF-01, PERF-02, PERF-03 |
| L7 | REST mixed workload | PERF-07 |

### 5.11 End-to-end tests (`E2E`)

Journeys: register → login → create workspace; invite and accept; build a page tree; edit; image upload; collaborate (two browsers); comment; snapshot and restore; permission restriction; logout/session revoke. A small smoke subset runs on every PR.

### 5.12 Security tests (`SEC`)

| Area | Checks |
|---|---|
| Passwords and sessions | Argon2id only; only token hashes stored; cookie attributes; idle and absolute expiry; revocation; password change revokes other sessions |
| CSRF/Origin | Disallowed `Origin` and non-JSON content types rejected on state-changing requests |
| Enumeration | Uniform login failures; invitation token errors indistinguishable (`INVITATION_INVALID`) |
| Rate limiting | `429` on auth, invitation, token and upload endpoints |
| Authorization (IDOR) | Access to resources in other workspaces/pages returns `404` by id guessing; cross-workspace parent/move rejected |
| Collaboration token | Tampering, wrong key, `alg` confusion, replay across pages, expiry |
| WebSocket | Origin allow-list, unauthorized document names, awareness spoofing (V14), oversized/malformed messages, command authorization |
| Uploads | Content-type vs actual content mismatch, size limits, key generation (client filename never used) |
| Injection / XSS | Titles, comment bodies, link URLs (`javascript:` and other disallowed schemes), image URLs; output encoding |
| SQL | Raw queries are parameterized (test with injection payloads) |
| Headers | `helmet` headers present; CORS allow-list |
| Dependencies | `pnpm audit` reviewed each release |
| Logging | No tokens, passwords or document content in logs (log-capture test) |

## 6. Guarantee verification (G1–G7)

A guarantee is stated in README/ARCHITECTURE as verified only when its tests pass in CI. Evidence is the list of passing test ids, recorded in HANDOVER.md.

| ID | Guarantee (short) | Required tests | Phase(s) |
|---|---|---|---|
| G1 | Convergence of replicas that applied the same updates | `CE` randomized in-process; `CE` through server; with restart; with restore; multi-instance | 5, 6, 8, 9 |
| G2 | Durability only after commit | `DB` locking and commit-boundary tests; `REC` kill before/after commit | 5, 6 |
| G3 | Bounded at-risk window; surviving client re-sends | `REC` with and without surviving client; PERF-05 measured lag | 6 |
| G4 | Recovery rebuilds all committed updates; compaction atomic | `REC` kill/restart; compaction fault injection; random history recovery equality | 5, 6, 9 |
| G5 | PostgreSQL durability is independent of Redis; live reconvergence requires explicit recovery | `REC`/`RECON` disconnect one subscriber, publish missed updates, reconnect Redis, detect stale documents, execute recovery/resync, compare document state and persisted state | 9 |
| G6 | Authorization at connect, downgrade/close within bounded time | `WS`, `PERM` revocation tests with and without events | 6, 9 |
| G7 | Snapshot immutability; pre-restore snapshot; non-destructive, serialized restore | `DB`, `WS`, `CE`, `REC`; cross-instance barrier, edits during restore, failure injection before/after PRE_RESTORE commit and restore commit | 8 |

## 7. Measurable performance metrics (PERF-01 … PERF-07)

All metrics are measured, never assumed. Targets are set only after a baseline exists (IMPLEMENTATION_PLAN AC-9.7), by decision.

| ID | Metric | How it is measured | Reported as |
|---|---|---|---|
| PERF-01 | Synchronization latency | A sender client makes a unique edit and records `performance.now()` when the change is applied to its local `Y.Doc`; the receiving client observes the same change through a document observer and records its own timestamp. **Sender and receiver run in one harness process (one clock)** to avoid clock skew. Same-instance and cross-instance runs are separate. | p50/p95/p99 and max over a defined sample; run profile |
| PERF-02 | Concurrent connections | Ramp connected clients per instance under a fixed per-client edit/awareness workload until a pre-declared limit condition (error rate, PERF-01 degradation, resource saturation) is reached; the last stable level is reported. | Count and the limit condition that ended the run |
| PERF-03 | Update propagation | Updates per second per document and per instance delivered to N subscribers; Redis messages per second; server CPU and memory at those rates. | Throughput, fan-out factor, resource use |
| PERF-04 | Recovery time | (a) Time from instance restart to the first client regaining a synced, editable document; (b) client reconnection time after a network drop. | Distribution over repeated runs |
| PERF-05 | Persistence lag | Time from an update being applied on the server to its commit in PostgreSQL (timestamps in server logs/metrics at apply and commit). | Distribution; maximum observed |
| PERF-06 | Document load time | Time to hydrate a document from `DocumentState` plus pending updates, as a function of state size and update count. | Table over sizes |
| PERF-07 | API latency | Per endpoint group, under a defined request mix and concurrency. | p50/p95/p99, error rate |

**Method rules:** warm-up period excluded; steady-state sampling window defined; several repetitions per profile; outliers reported, not discarded; machine, OS, CPU/RAM, Node.js version, dependency versions, PostgreSQL/Redis versions and configuration, instance count and network setup recorded with every result.

## 8. Traceability

Phase 1a infrastructure tests exist and have been run; feature-specific rows below remain not started until their phase implements them. The Phase 10 acceptance criterion AC-10.1 requires no empty rows.

### 8.0 Phase 1a executed evidence (owner-reported 2026-11-12)

| Evidence | Result |
|---|---|
| Test suite | 9 files; 59 tests passed (47 unit, 12 integration) |
| Unit/integration coverage | Shared env/envelope/error/health logic, API and collab shell endpoints, dependency readiness/degraded behaviour, real-process startup/shutdown, and module-boundary lint rules |
| Root checks | `pnpm check` passed: lint, Prettier check, typecheck and tests |
| CI | GitHub Actions workflow passed on the owner-reported run |
| Database | `pnpm db:migrate:deploy` succeeded; `pnpm db:migrate:status` reported up to date |
| Infrastructure | Docker Compose PostgreSQL and Redis services reported healthy; local PostgreSQL host port is 5433 → container 5432 |
| Not covered | S1–S11 collaboration spike, product-feature tests, performance/load baselines, production Docker image build/deployment |

The table records results reported by the project owner; it is not an independent rerun by this documentation review. Detailed phase acceptance evidence is in HANDOVER.md.

### 8.0a Phase 2 executed evidence (Claude, preparation environment, 2026-11-13)

Environment (not the owner's machine and not CI): Linux x86-64, 1 vCPU, Node 24.18.0 (npm package `node@24.18.0`), pnpm 12.18.0, **PostgreSQL 16.x** (apt; the project targets 17), Redis 7.x from apt, `next dev`/`next start` 16.4.6. The Prisma schema engine binary could not be downloaded there, so the Phase 2 migration SQL was applied with `psql` and `_prisma_migrations` was filled by script instead of `prisma migrate deploy`.

| Evidence | Result |
|---|---|
| `pnpm test` (twice) | 17 files, 228 tests passed both times (about 35–48 s); exit code 0 |
| `pnpm run test:unit` | 9 files, 115 tests passed |
| `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck` | all passed |
| `next build` | succeeded (all routes dynamic) |
| Mutation spot checks | Temporarily breaking one behaviour at a time made tests fail as intended: ignoring `revokedAt` (3 failures), skipping the Origin allow-list (3), cookie without `HttpOnly` (2), accepting any password (2), ignoring the absolute expiry (1), removing the web 401 handler (2). Sources were restored afterwards. |

| File | Category | Covers |
|---|---|---|
| `packages/shared/src/auth.test.ts` | UT | Request/response schemas, normalization, password bounds, strict objects, cookie name, session env |
| `apps/api/test/auth-units.test.ts` | UT | Argon2id hashing/verification, token generation/hash (SHA-256 vector), Redis-outage error detection |
| `apps/api/test/auth.int.test.ts` | API, DB, SEC | Register, login, logout, session list/revoke, password change, profile, all endpoints' success and error codes, 401 on every protected route, cookie attributes, Origin/Content-Type/CORS, uniform login errors, event publication, no secrets in responses |
| `apps/api/test/session-lifecycle.int.test.ts` | API, DB | Idle expiry, sliding refresh, 30-day absolute cap, throttled `lastSeenAt` (controlled clock), expired sessions hidden/not revocable, cleanup job, DB constraints (lower-case email, colour format, token-hash format, unique email, cascade) |
| `apps/api/test/security.int.test.ts` | SEC | Per-IP and per-account rate limits, 429 + `Retry-After`, fail-closed 503 for Redis and 503 for PostgreSQL outages, `X-Forwarded-For` handling (trusted/untrusted peer, forged left-most entry), production `__Host-` cookie, no secrets in logs, uniform error envelope |
| `apps/api/test/web-auth.int.test.ts` | IT, E2E (HTTP level) | Real API process + real `next dev` server: redirects, proxy forwarding (V7), register → protected page → profile update → logout |
| `apps/web/src/lib/api-client.test.ts`, `apps/web/src/components/auth-flows.test.tsx` | UT (jsdom) | API client envelope handling; login, registration, profile, password, header/logout and sessions UI flows, 401 handling, double-submit protection |
| `packages/db/test/health.int.test.ts` (extended) | DB | Readiness requires every shipped migration; tolerates newer extras |

**Not tested, stated plainly:** real browsers (cookie storage, form behaviour, layout); any Docker image build; the Compose `apps` profile; `prisma migrate deploy`/`migrate diff` for the Phase 2 migration; PostgreSQL 17; load behaviour of the rate limiter or Argon2 under concurrency beyond the 8-hash timing above; the web app behind a real reverse proxy.

### 8.1 Requirements

| Requirement group | Primary categories | Phase |
|---|---|---|
| FR-AUTH-01 … 07 | `UT`, `DB`, `API`, `SEC`, `E2E` | 2 |
| FR-WS-01 … 08 | `API`, `PERM`, `DB`, `E2E` | 3 |
| FR-PG-01 … 06 | `API`, `PERM`, `DB`, `E2E` | 3 |
| FR-PG-07 | `WS`, `REC`, `E2E` | 6 |
| FR-ED-01 … 09 | `UT`, `E2E`, `API` (assets), `SEC` | 4 |
| FR-RT-01, 03 | `CE`, `UT`, `DB` | 5 |
| FR-RT-02, 04 … 06 | `WS`, `CE`, `RECON`, `REC`, `MB` | 6 |
| FR-PR-01 … 05 | `MB`, `SEC`, `E2E` | 7 |
| FR-CM-01 … 06 | `API`, `PERM`, `CE`, `E2E` | 8 |
| FR-VH-01 … 06 | `API`, `WS`, `DB`, `CE`, `E2E` | 8 |
| FR-PM-01, 02 | `PERM`, `API` | 3 |
| FR-PM-02 (WS part), 03, 04 | `PERM`, `WS` | 6, 9 |
| FR-SC-01, 03 | `CE`, `REC`, `LOAD`, `WS` | 9 |
| FR-SC-02, 04 | `DB`, `REC`, `GT` | 5, 6, 9 |
| NFR-SEC-01 … 05 | `SEC` | 2, 6, 10 |
| NFR-REL-01 | `GT` (G1–G7) | 5–9 |
| NFR-MNT-01, 02 | CI lint/typecheck/boundary tests | 1 onward |
| NFR-A11Y-01 | `E2E` keyboard checks | 4, 7, 10 |

### 8.2 Endpoints

| Endpoint group (ids) | Categories | Phase |
|---|---|---|
| `AUTH-01` … `AUTH-07`, `USER-01`, `USER-02` | `API`, `SEC`, `DB` | 2 (avatar part 4) |
| `WS-01` … `WS-09`, `INV-01` … `INV-06` | `API`, `PERM`, `SEC`, `DB` | 3 |
| `PAGE-01` … `PAGE-09`, `PP-01` … `PP-03` | `API`, `PERM`, `DB` | 3 |
| `ACT-01`, `ACT-02` | `API`, `PERM` | 3 |
| `ASSET-01` … `ASSET-03` | `API`, `SEC`, `E2E` | 4 |
| `PAGE-10` | `API`, `WS`, `SEC` | 6 |
| `CMT-01` … `CMT-06` | `API`, `PERM` | 8 |
| `VER-01` … `VER-03` | `API`, `PERM` | 8 |
| `OPS-01`, `OPS-02` | `IT` | 1 (Phase 1a tests pass) |

### 8.3 Permission matrix

PROJECT_MASTER §5 is the single source for the matrix. Every cell (role × action) maps to at least one generated `PERM` test (REST and, for editing/commenting, WebSocket). The generated test list is stored with the fixtures and counted in AC-3.2 and AC-10.1.

## 9. CI pipeline

| Stage | Contents | Trigger |
|---|---|---|
| Fast | install (frozen lockfile), lint (incl. boundaries), typecheck, `UT`, `DB`, `API`, `IT` | every push/PR |
| Standard | `WS`, `PERM`, `SEC` (fast), `CE` (short seeds), `REC`/`RECON` subsets, `E2E` smoke | every PR |
| Nightly | `CE` (long seeds), `MB` full (3 browsers), `REC`, `RECON`, `E2E` full | scheduled |
| Pre-release | `LOAD` runs with recorded results, `SEC` full, dependency audit | before a release/phase sign-off |

GitHub Actions is the configured and owner-reported passing CI provider. The current workflow uses PostgreSQL and Redis service containers; object storage is not part of Phase 1 CI (D37). The Fast/Standard/Nightly/Pre-release stages above are the intended future testing strategy, not all implemented as separate jobs in the current workflow.

## 10. Recording results

- Measured results go in dated records under `docs/` (spike results in `docs/spikes/`, load results alongside TESTING.md or a `docs/results/` folder created in Phase 9), with the environment details from §7.
- HANDOVER.md lists, per phase, the acceptance criteria and the test ids that satisfy them.
- A test that is skipped, flaky or deleted must have a recorded reason and owner; flaky tests are fixed or quarantined within the phase, never silently retried.
- Coverage is reported for information; gating thresholds are decided in Phase 10.

## 11. Open items

GitHub Actions is the confirmed CI provider; the Phase 1a workflow is configured and the owner reports a passing run on 2026-11-12.

| Item | Resolved in |
|---|---|
| Value of N (client count) for the standard `CE` through-server test | Phase 6 (chosen from spike results and recorded) |
| Fault-injection proxy implementation | Phase 6 |
| Load-test stop criteria and run plans | Phase 9 (before each run) |

## 12. Commands (implemented in Phase 1)

| Command | What it does | Needs services |
|---|---|---|
| `pnpm lint` / `pnpm format:check` | ESLint (including module-boundary rules) / Prettier check | No |
| `pnpm typecheck` | Builds packages, runs `tsc --noEmit` in every workspace and for root tests | No |
| `pnpm test:unit` | Vitest project `unit` (`*.test.ts` and, with `// @vitest-environment jsdom`, `*.test.tsx`): env validation, envelope/errors, health logic with fake dependencies, collab HTTP/WebSocket shell, boundary-lint deliberate violations, startup fail-fast | No |
| `pnpm test:integration` | Vitest project `integration` (`*.int.test.ts`): real PostgreSQL and Redis, readiness incl. outage cases, real process start and shutdown. POSIX/Linux verifies graceful SIGTERM and exit code 0; Windows verifies startup, health endpoints and process termination because Windows does not deliver catchable POSIX signals to child processes. | Yes: `DATABASE_URL`, `REDIS_URL`, migrations applied |
| `pnpm test` | Both projects | Yes |

Integration tests **fail** (they do not skip) if `DATABASE_URL`/`REDIS_URL` are missing. The GitHub Actions verification job runs on `ubuntu-latest`, so the real-process tests exercise the production SIGTERM handlers and require exit code 0 in CI. Windows local runs still verify that both child processes start, serve their health/readiness endpoints, and terminate; they do not claim to verify graceful SIGTERM handling. Playwright (E2E) is not configured yet; it arrives with the first end-to-end flow (Phase 2).