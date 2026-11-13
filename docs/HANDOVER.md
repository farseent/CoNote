# CoNote – Handover

**Last updated:** 2026-11-13

**Current phase:** Phase 2 – Authentication and User Management. **Implementation and owner-run local acceptance checks are complete (2026-11-13, §7.9). D41–D47 are explicitly accepted. Final Phase 2 sign-off remains pending; GitHub Actions CI for Phase 2 was explicitly deferred by the owner and has not been run.** The owner issued the Phase 2 task on 2026-11-13; that instruction was treated as approval to start Phase 2 although the earlier formal Phase 1 closure sign-off (§4) was not recorded in the repository. The Phase 1 historical items listed as open in §1 remain open.

**Next phase after acceptance:** Phase 3 – Workspaces, Pages and Permissions. **Not started.** Do not start Phase 3 until the owner gives final Phase 2 sign-off and the deferred CI decision is resolved.

Read `CLAUDE.md` first. This file is the source of truth for current project status.

## 1. Current status

| Area | Current state |

|---|---|

| Repository | pnpm monorepo with `apps/web`, `apps/api`, `apps/collab`, `packages/db`, `packages/shared`, `packages/editor`; root scripts, CI, Dockerfiles and local Compose configuration are present |

| Product features | **Implemented (Phase 2): registration, login, logout, DB-backed sessions, session list/revoke, password change, profile (display name, presence colour) with web pages.** Not implemented: workspaces, page management, rich-text editor, production Yjs collaboration, presence, comments, version history, avatars (Phase 4), email verification, password reset |

| API | Fastify foundation, `/health` and `/ready`, and (Phase 2) `AUTH-01`–`AUTH-07`, `USER-01`–`USER-02` under `/api/v1`, with CSRF checks, rate limiting, helmet, CORS, session cleanup job |

| Collaboration server | Hocuspocus shell and operational endpoints implemented. It deliberately rejects every document connection; this is not a working collaboration service (D38) |

| Database | Prisma 7.10.1; baseline migration plus `20261112120000_auth_users_sessions` (`User`, `Session`). That migration is hand-written SQL. The owner's local `migrate deploy`, `migrate status` and scratch-database `migrate:dev` drift check were clean on 2026-11-13 (§7.9). No document persistence exists |

| Local infrastructure | PostgreSQL 17 and Redis 7 Compose services reported healthy. PostgreSQL host port 5433 maps to container port 5432; Redis host port 6379 |

| Phase 1a verification | Owner reports `pnpm check` passed, 59 tests passed (47 unit + 12 integration), migrations deployed and up to date, Docker Compose PostgreSQL/Redis healthy, GitHub Actions CI passed, and the web shell was checked in a browser |

| Docker app images | **Verified by owner on 2026-11-13:** API, web, collab and migration images built successfully; Compose `apps` profile started all application services; migration container exited 0 with no pending migrations; API `/ready` returned HTTP 200 with PostgreSQL and Redis healthy |

| Phase 1b spike | Harness and report at `spikes/collab-poc/` and `docs/spikes/phase-1-collab-spike.md`; S1–S11 executed, 11/11 PASS. Root `pnpm check` passed; remaining evidence reconciliation and owner review are in progress |

| Phase 2 | Implemented and owner-verified locally. Lint, format check and typecheck passed; 228 tests passed with `--testTimeout=20000`; migration deploy/status and scratch-database drift check passed; browser acceptance checks completed; current-session indicator fixed; Docker app images built and services started; API `/ready` returned HTTP 200 with PostgreSQL and Redis healthy. D41–D47 accepted. **GitHub Actions CI for Phase 2 deliberately deferred and not run. Final owner sign-off pending.** |

### Decisions and open items

- **D33:** Owner selected Phase 1b before Phase 2. D33 is recorded as accepted.

- **U1 / D16:** Node.js 24 was explicitly approved by the project owner on 2026-11-12. The spike and root checks used Node.js 24.18.0.

- **U2 / D17:** TypeScript 5.9.3 was explicitly approved by the project owner on 2026-11-12.

- **U3 / U4:** Empirical evidence is available from S1–S7. These questions are only partially resolved: store-on-unload, direct concurrent row-lock behaviour, stale awareness after a Hocuspocus instance crash and awareness expiry values remain unverified.

- **U5 / V8:** Resolved by Phase 1a evidence: Prisma client generation, real database connectivity, successful `migrate deploy`, and `migrate status` reporting up to date.

- **U7 / D37:** Object storage/MinIO is deliberately omitted from Phase 1 Compose; revisit in Phase 4.

- **U13:** Explicit production recovery after Redis Pub/Sub message loss remains a Phase 9 decision. Redis reconnection alone is not proof of reconvergence.

- **Phase 2 items:** D41–D47 were explicitly accepted by the owner on 2026-11-13 (see DECISIONS.md). V7 is resolved by measurement (Next.js does not set `X-Forwarded-For`; production needs an outer reverse proxy, D43). The actual production hosting target and proxy deployment remain open under U10; D43 approves the trusted-address-list design, not a specific hosting provider.
- **D34–D40:** Their individual statuses remain as recorded in DECISIONS.md; do not infer blanket owner approval from implementation or test evidence.

The uploaded ZIP does not include `.git`, so it cannot independently establish the current branch or commit. The owner previously reported that commit `ba82d24` (`feat: Phase 1 project setup and infrastructure`) was pushed to `origin/main`.

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

### 2.3 Decisions needing owner sign-off (Phase 0 historical snapshot)

This is the Phase 0 owner-review snapshot and is retained for history. D16 and D17 were subsequently approved by the owner on 2026-11-12; current statuses are recorded in DECISIONS.md. Other entries retain their individual statuses there.

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

### 2.4 Unresolved decisions (Phase 0 historical snapshot; current status is in DECISIONS.md)

| ID | Question | Needed by |

|---|---|---|

| U1 | Node.js 24 or 26 | Resolved in Phase 1b; owner approved Node.js 24 on 2026-11-12 |

| U2 | TypeScript 5.9.3 or newer | Resolved in Phase 1b; owner approved TypeScript 5.9.3 on 2026-11-12 |

| U3 | Hocuspocus store-hook/Redis persistence behaviour | Phase 1 spike |

| U4 | Awareness semantics across instances and from read-only connections | Phase 1 spike |

| U5 | Prisma 7 monorepo setup details | Resolved in Phase 1a; see DECISIONS.md |

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

Tracked in `docs/ARCHITECTURE.md` §18. The Phase 1b spike has supplied evidence for several assumptions, but not all are fully resolved. V2, V5 and V12 passed at spike level; V1 and V3 are partial; V4 showed that Redis restart alone does not reconverge already-open documents; V6 fresh-token acquisition on an actual reconnect remains unverified; V11 was inspected at capability/declaration level only; V13 remains open; V14 is partial because forged identity was rejected but name/color tampering was not tested. See `docs/spikes/phase-1-collab-spike.md` and reconcile §18 to retain these evidence levels. V7 (Next.js rewrite forwarding) is Phase 2; V8 (Prisma monorepo setup) was resolved in Phase 1a; V9 (Yjs binding package) is Phase 5; V10 (server-side restore transaction) is Phase 8.

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

## 3. Phase 1a – implementation and verification record

### 3.1 Implemented foundation

- **Monorepo/tooling:** pnpm 12.18.0 workspace; Node 24 engine and `.nvmrc`; strict TypeScript with `noUncheckedIndexedAccess`; ESLint module-boundary rules; Prettier; Vitest unit/integration projects; exact pins.

- **Web:** Next.js 16.4.6, React 19.3.1, Tailwind 4.3.5 starter shell, `/health`, startup environment validation.

- **API:** Fastify 5.12.8 shell, structured/redacted logging, request IDs, standard error handling, `/health` and `/ready`, graceful shutdown.

- **Collab:** Hocuspocus 4.8.0 shell, `/health` and `/ready`, graceful shutdown. `onConnect` rejects every document connection intentionally (D38).

- **Database:** Prisma 7.10.1, `@prisma/adapter-pg`, `prisma-client` generator output under `packages/db/src/generated/prisma`, `prisma.config.ts`, and an empty baseline migration (`SELECT 1;`). No application models yet.

- **Shared/editor:** shared Zod environment schemas, error/envelope/health/logging utilities; editor package is an empty entry point.

- **Infrastructure/CI:** Docker Compose for PostgreSQL 17 and Redis 7; optional app Docker profile; GitHub Actions workflow; `.env.example`; bootstrap script.

### 3.2 Phase 1a acceptance criteria

Results below are based on the owner's reports in chat dated 2026-11-12. This review did not independently rerun the commands.

| Criterion | Status | Evidence / qualification |

|---|---|---|

| AC-1.1 – frozen-lockfile install | **Pass (owner-reported)** | `pnpm install --frozen-lockfile`; CI also passed |

| AC-1.2 – lint, typecheck and tests | **Pass (owner-reported)** | `pnpm check` passed |

| AC-1.3 – module boundaries | **Pass (repository evidence + reported test run)** | `tests/boundaries.test.ts` contains 13 deliberate forbidden-import cases and 4 allowed-import cases |

| AC-1.4 – local infrastructure | **Pass with D37 scope adjustment (owner-reported)** | PostgreSQL and Redis Compose services reported healthy. Object storage is not required in Phase 1; D37 defers MinIO |

| AC-1.5 – service shells/readiness | **Pass (owner-reported)** | API/collab/web shells and readiness behaviour covered by the current unit/integration tests |

| AC-1.6 – pins and runtime declarations | **Pass for Phase 1 packages (owner-reported)** | Root and workspace package manifests, `.nvmrc`, and `pnpm-lock.yaml` are present. Future-phase dependencies remain to be verified when added |

| AC-1.7 – Prisma setup and migration | **Pass (owner-reported)** | `pnpm db:migrate:deploy` succeeded; `pnpm db:migrate:status` reported up to date. U5/V8 resolved |

| AC-1.8 – S1–S11 collaboration spike | **Pass (11/11)** | All eleven manual scenarios passed. Evidence, environment, observations and limitations are recorded in docs/spikes/phase-1-collab-spike.md. |

| AC-1.9 – spike findings for U3/U4/V1–V6/V11–V14 | **Partly complete** | S1–S11 provide empirical evidence. S4/S5 persistence and Redis-originated update behaviour, S2/S3 awareness propagation and read-only awareness, S7 outage behaviour, S8 token verification, S9 stateless messages and S10 forged awareness identity rejection passed. Store-on-unload, direct concurrent row-lock behaviour, stale awareness after server crash, actual fresh-token reconnect, provider close-code behaviour and production limit enforcement remain unverified or deferred. |

| AC-1.10 – architecture implications and U1/U2/U5 | **Partly complete** | U1 (Node.js 24) and U2 (TypeScript 5.9.3) were explicitly approved by the owner on 2026-11-12; U5/V8 were already resolved. Remaining spike implications must be reconciled in ARCHITECTURE.md, WEBSOCKET_PROTOCOL.md, IMPLEMENTATION_PLAN.md and DECISIONS.md. |

| AC-1.11 – spike cleanup and no production collaboration code | **Pass at repository-boundary level** | Spike remains isolated under spikes/collab-poc/. Root pnpm check passed after the changes; root lint/format/build/typecheck/test workflows completed with the spike excluded. Git status showed only documentation, root tooling configuration and isolated spike paths. No production collaboration feature, production Prisma model or production migration was added. Retain the spike as evidence pending owner review. |

### 3.3 Test and CI evidence

| Check | Owner-reported result |

|---|---|

| Test suite | 9 test files; 59 tests passed (47 unit, 12 integration) |

| Root checks | Pass (owner-executed, 2026-11-12): `pnpm check` passed after Phase 1b changes, including ESLint, Prettier check, package builds, TypeScript checks and Vitest; 9 test files and 59 tests passed. |

| Database | Baseline migration deploy succeeded; migration status up to date |

| Local services | PostgreSQL and Redis Compose containers reported healthy |

| CI | GitHub Actions run passed |

| Browser smoke check | Web starter shell was opened and checked in a browser |

| Docker app-image build | Not confirmed; do not mark as passed |

The integration tests use real PostgreSQL and Redis. The test files in the uploaded snapshot include `tests/boundaries.test.ts`, `tests/startup*.test.ts`, `apps/api/test/*`, `apps/collab/test/*`, `packages/db/test/*`, and `packages/shared/src/shared.test.ts`.

### 3.4 Repository audit findings relevant to Phase 1b

- The initial uploaded repository ZIP had no spike source or results report. The current working copy now contains the isolated harness and completed evidence report; S1–S11 have since been executed (11/11 PASS).

- `apps/collab` is only a shell: the Hocuspocus `onConnect` hook rejects every document connection. Do not build Phase 1b experiments inside this production shell.

- `packages/db/prisma/schema.prisma` has no models. The baseline migration contains only `SELECT 1;`. The spike must use a disposable schema/database and must not add spike tables to the production Prisma migration history.

- The current Compose mapping is PostgreSQL host `5433` → container `5432`; `.env.example` must use `localhost:5433` for host-run apps. The documentation correction package updates this value.

- Redis is Pub/Sub, not durable. Missed messages are not replayed after reconnect; the spike must not describe Redis restart alone as a successful recovery.

- MinIO/object storage is not in the Phase 1 Compose file by design (D37).

### 3.5 Phase 1b scope and guardrails

Phase 1b is a **disposable, manual-scripted collaboration spike** under `spikes/collab-poc/`, outside the workspace build and not imported by any package. It must not add production collaboration features, real authentication, production migrations or production persistence.

The executed isolated spike used two Hocuspocus instances on ports `4201` and `4202`, isolated Redis on host port `6380`, and the throwaway PostgreSQL database `conote_collab_poc`. It did not use the production collaboration server on port `4100` or root Redis on port `6379`. S1–S11 results and limitations are recorded in `docs/spikes/phase-1-collab-spike.md`.

Important scope boundaries:

- The spike provides evidence for U3/U4 and V1–V5, V12–V14, but some behaviours remain partial or unverified as listed in the execution report.

- V6 (fresh token acquisition on reconnect) may be inspected at library-capability level in the spike, but production token refresh belongs to Phase 6.

- V11 message/connection limits may be inspected for available Hocuspocus mechanisms; production enforcement and tuning belong to Phases 6/9.

- V14 was prototyped: forged awareness identity was rejected. Name/color tampering was not tested; production presence identity enforcement belongs to Phase 7.

- U13 production recovery design is decided and load/recovery-verified in Phase 9. The spike can test candidate resynchronization feasibility but cannot close the production requirement.
- S7 result: Redis restart alone did not reconverge already-open documents; both Hocuspocus instances had to restart and rehydrate from PostgreSQL. Do not describe Redis reconnect alone as successful recovery. U13 remains a Phase 9 production requirement.

- Do not use `docker compose down -v`; it deletes the local PostgreSQL volume.

## 4. Next steps – Phase 1b documentation review and closure

The owner selected Phase 1b before Phase 2. The isolated spike has now been executed, with S1–S11 all passing (11/11). The next task is to reconcile the evidence across `docs/spikes/phase-1-collab-spike.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `WEBSOCKET_PROTOCOL.md`, `IMPLEMENTATION_PLAN.md`, `TESTING.md` and this handover. Do not start Phase 2 until the owner has reviewed the evidence and explicitly approved Phase 1 closure.

The following limitations must remain explicit during review:

1. U3/U4 are only partially resolved by the spike. Store-on-unload, direct concurrent row-lock behaviour, stale awareness after a Hocuspocus instance crash and awareness expiry values remain unverified.

2. S7 showed that Redis restart alone does not automatically reconcile existing documents (`autoConverged=false`). Both Hocuspocus instances had to restart and rehydrate from PostgreSQL before the documents converged. U13 remains a Phase 9 production recovery requirement.

3. V6 fresh-token acquisition on an actual reconnect remains unverified; production token refresh belongs to Phase 6.

4. V11 capability inspection does not establish production abuse protection or effective limit enforcement; production enforcement and tuning belong to later phases.

5. V13 provider close-code/reason behaviour remains unverified. V14 is partial: forged awareness identity was rejected, but name/color tampering was not tested.

6. Keep Phase 2 blocked until the owner reviews the reconciled documentation and explicitly approves Phase 1 closure and Phase 2.

The next owner review should verify that the spike findings have been reconciled in the linked documents and that no remaining statement describes the spike as pending. Phase 2 remains blocked until explicit approval.

## 5. Phase 1b preparation record (2026-11-12)

The owner supplied `Conote_Phase_1b.zip`. Work was performed on an extracted copy because the archive does not include `.git`; branch, commit and working-tree cleanliness therefore cannot be independently verified from this snapshot.

### Files prepared

- `spikes/collab-poc/src/server.ts`: two-instance Hocuspocus prototype, throwaway EdDSA authentication, read-only context, awareness identity filtering, stateless echo and PostgreSQL diff/compaction prototype.

- `spikes/collab-poc/src/run.ts`: manual scenario runner for S1–S11, including two server processes and the isolated Redis outage experiment.

- `spikes/collab-poc/src/check-environment.ts`: safety preflight for the throwaway database and isolated Redis.

- `spikes/collab-poc/run-phase1b.sh`: one-command local install, preflight, typecheck, build and S1–S11 runner.

- `spikes/collab-poc/README.md`: setup, execution and safety instructions.

- `docs/spikes/phase-1-collab-spike.md`: initially prepared as an evidence report scaffold with scenarios marked not executed; subsequently populated with the S1–S11 execution results.

- `DECISIONS.md`, `ARCHITECTURE.md`, `WEBSOCKET_PROTOCOL.md`, `IMPLEMENTATION_PLAN.md`, and `TESTING.md`: updated to distinguish source/API inspection from empirical verification.

- Root ESLint and Prettier ignore rules exclude the separate spike directory from root project checks; the spike retains its own typecheck/build scripts.

### Preparation-environment verification (historical; not the final execution environment)

- Archive extraction and project structure inspection succeeded.

- TypeScript syntax transpilation succeeded for the three spike `.ts` files using global TypeScript 5.8.3.

- At preparation time, full typecheck, package build, dependency installation and live S1–S11 execution were not run in that extracted work environment, which had Node 22.16.0, TypeScript 5.8.3, no pnpm and no Docker. The owner subsequently executed the spike and root checks locally; see the execution record below.

- No production collaboration code, Prisma model or production migration was added.

- The spike runner refuses to use any database except `conote_collab_poc` and Redis port other than `6380`. It does not run destructive database or volume cleanup.

### Phase 1b execution and verification (2026-11-12)

The owner executed the isolated spike locally using Node.js 24.18.0 and TypeScript 5.9.3. S1–S11 all passed (11/11 PASS).

Root pnpm check passed after the Phase 1b changes: ESLint, Prettier, package builds, TypeScript checks and Vitest. The root test suite passed 9 test files and 59 tests.

U1 was explicitly approved by the project owner: Node.js 24. U2 was explicitly approved by the project owner: TypeScript 5.9.3 (both approvals on 2026-11-12).

S7 observation: Redis restart alone did not automatically converge the already-open documents (autoConverged=false). After both Hocuspocus servers restarted and rehydrated from PostgreSQL, the documents converged. The Redis outage produced ECONNREFUSED 127.0.0.1:6380 warnings. This is evidence that production requires an explicit recovery mechanism; U13 remains a Phase 9 requirement.

No production collaboration feature, production Prisma model or production migration was added. Git status after the checks showed only the expected documentation, root tooling configuration and isolated spike paths.

The full scenario evidence and remaining limitations are recorded in docs/spikes/phase-1-collab-spike.md. AC-1.8 is met at spike level; AC-1.9 and AC-1.10 remain partly complete pending documentation reconciliation and the explicitly listed unverified behaviours. AC-1.11 is met at repository-boundary level. Phase 1 closure and Phase 2 remain subject to explicit owner approval.

## 6. Change log

| Date | Change |

|---|---|

| 2026-11-11 | Phase 0 documentation created and initial design consistency review performed. |

| 2026-11-11 | Corrected Redis outage/recovery, owner invariant, readiness, page-tree concurrency and version-restore design. |

| 2026-11-12 | Phase 1a infrastructure implemented and owner-reported checks/CI/migrations passed; Phase 1b selected by owner before Phase 2. |

| 2026-11-12 | Documentation status reconciled with the repository snapshot and owner-reported verification; Phase 1b scope boundaries clarified. |

| 2026-11-12 | Phase 1b harness and report scaffold prepared; no S1–S11 results claimed at preparation time. |
| 2026-11-12 | Phase 1b S1–S11 executed (11/11 PASS); root pnpm check passed (9 test files, 59 tests); U1/U2 explicitly owner-approved; handover updated for evidence-based review. |
| 2026-11-13 | Phase 2 (authentication and user management) implemented and tested in a preparation environment; docs updated; decisions D41–D47 proposed; V7 resolved by measurement. Awaiting owner verification (§7). |
| 2026-11-13 | Owner verification of Phase 2 completed locally: migrations/drift check, lint/format/typecheck, 228 tests (20 s timeout), manual browser acceptance, Docker app images/startup and API readiness passed; current-session indicator fixed. D41–D47 accepted. Phase 2 GitHub Actions CI explicitly deferred/not run; final sign-off pending (§7.9). |

## 7. Phase 2 – implementation and verification record (2026-11-13)

### 7.1 What was implemented

| Area | Implementation |
|---|---|
| `packages/shared` | `auth.ts`: Zod request/response schemas (strict objects, normalization, password 12–128), cookie-name helper, access-event channel/type, presence-colour palette. `env.ts`: `TRUST_PROXY` (address list), `SESSION_IDLE_TTL_DAYS`, `SESSION_ABSOLUTE_TTL_DAYS` |
| `packages/db` | `User` and `Session` models; migration `20261112120000_auth_users_sessions` with the `users` check constraints and a token-hash format check; `isUniqueConstraintError`, `isDatabaseUnavailableError`; readiness now requires every shipped migration (D41) |
| `apps/api` | Argon2id hashing; `SessionService` (hashed tokens, idle/absolute expiry, throttled sliding refresh, injected clock); `requireAuth` guard (`preValidation`, D44); routes `AUTH-01`–`AUTH-07`, `USER-01`–`USER-02`; helmet, CORS allow-list, cookie handling, Origin/Content-Type check, `no-store`; Redis rate limiting (fail closed); Zod validation and response serialization; error mapping (validation details, 503 for PostgreSQL/Redis outages); `session.revoked` event publishing; hourly session cleanup job |
| `apps/web` | `/api/*` rewrite to the API; login, register and profile pages (profile, password change, active sessions); server-side guards (`requireUser`, `redirectIfSignedIn`); client `AuthProvider`; typed API client; shared-schema form validation; error page |
| Infra and config | `.env.example`, `infra/Dockerfile.web` (build arg `API_INTERNAL_URL`), `infra/docker-compose.yml` (`TRUST_PROXY`, build arg), `pnpm-workspace.yaml` (`argon2` build approval), `vitest.config.ts` (TSX/jsdom + `@/` alias) |
| Docs | DATABASE_SCHEMA, API_CONTRACTS, ARCHITECTURE §10, DECISIONS (D35 note, D41–D47), IMPLEMENTATION_PLAN, TESTING, DEPLOYMENT, README, this file |

### 7.2 Acceptance criteria (IMPLEMENTATION_PLAN, Phase 2)

| ID | Status | Evidence / caveat |
|---|---|---|
| AC-2.1 | Met | Test reads the stored row: Argon2id string with the recorded parameters, not containing the password. Parameters and timings: ARCHITECTURE §10.1 (sandbox timings only) |
| AC-2.2 | Met | Test: stored `tokenHash` is 64 hex characters, differs from the cookie token, and the raw token appears nowhere in the session rows; a DB constraint rejects non-digest values |
| AC-2.3 | Met | API tests inspect `Set-Cookie` (development and production configurations, including clearing) |
| AC-2.4 | Met | Controlled-clock tests: idle expiry, 30-day absolute expiry with continuous activity, immediate revocation |
| AC-2.5 | Met | Success and every documented error code for each endpoint is exercised |
| AC-2.6 | **Partly met** | API: every protected endpoint returns `401`. Web: redirects to `/login` verified over HTTP against a real Next.js server. **No browser E2E was run** (Playwright not implemented/installable here) |
| AC-2.7 | Met | Missing/foreign Origin → `403 INVALID_ORIGIN`; wrong content type → `415` |
| AC-2.8 | Met | `429 RATE_LIMITED` with `Retry-After` on repeated logins (per IP and per account) |
| AC-2.9 | Met | Unknown email and wrong password return identical status and body shape |
| AC-2.10 | Met | Password change keeps the current session and revokes all others |
| AC-2.11 | Met | V7 measured and covered by `apps/api/test/web-auth.int.test.ts`; finding in §7.4 |
| AC-2.12 | Met | Cleanup job test (deletes beyond the 24 h grace, keeps the rest, idempotent) |

### 7.3 Test and check evidence

Run by Claude in a preparation environment (details and limits: TESTING §8.0a): `pnpm test` → 17 files, 228 tests passed, twice in a row (115 unit + 113 integration); `pnpm lint`, `pnpm format:check`, `pnpm typecheck` passed; `next build` succeeded. The owner reproduced them locally on 2026-11-13 (see §7.9); CI has not yet been run on Phase 2.

### 7.4 Findings made while implementing

1. **Authentication ran after validation.** An unauthenticated `PATCH` with an invalid body returned `400`, not `401`. Fixed by moving the guard to `preValidation` (D44); tests now call every protected route unauthenticated (two of them with bodies that would fail validation) and expect `401`.
2. **V7: Next.js does not set `X-Forwarded-For`** and forwards a client-supplied one unchanged (verified on the dev server and on `next start`). A first draft that trusted the proxy as a boolean would have let clients forge their address. Replaced by a trusted-address list (D43); production needs an outer reverse proxy that sets the header (ARCHITECTURE §10.3). Fastify 5.12 also ignores numeric `trustProxy` values, which ruled out a hop count.
3. **Mixed clocks.** `passwordChangedAt` was written by the database default at registration but by the application clock on password change, which made a test fail in one environment. The register path now sets it from the application clock.
4. **Release-age gate.** `pnpm add` silently added an exclusion for a one-day-old `user-event`; replaced by an older version and the exclusion removed (D47).
5. **Readiness could not detect a missing migration** (D35 limitation). Fixed (D41).

### 7.5 Deviations from the design documents

`avatarAssetId` and the `Asset` relation are not created (Phase 4); `SESSION_COOKIE_NAME` and `ARGON2_*` variables were not implemented (D42, DEPLOYMENT); an extra check constraint on `sessions.tokenHash`; every state-changing request must carry a JSON body (send `{}`); `TRUST_PROXY` is an address list. All are recorded in DATABASE_SCHEMA §4.1.1, API_CONTRACTS §3.1 and DECISIONS.

### 7.6 Not verified and known limitations

- **Browser E2E:** Playwright browser E2E tests are not implemented. Owner-run manual browser acceptance checks passed; jsdom and real-Next.js HTTP tests remain the automated frontend coverage (AC-2.6 is therefore partly met, not fully met).
- **GitHub Actions CI for Phase 2:** deliberately deferred by the owner on 2026-11-13. It was **not run** and must not be recorded as passed. The historical Phase 1a/1b CI pass in §3 remains a separate result.
- **Production proxy deployment:** the D43 trusted-proxy configuration is accepted, but the actual production reverse proxy and hosting target are not selected (U10). Production must place the web tier behind a trusted reverse proxy that sets `X-Forwarded-For`; do not expose the web tier directly.
- Rate-limit values and the Argon2 cost are starting values, not tuned (no target hardware or traffic estimate exists).
- No email verification, password reset, breached-password check, account lockout notification, CSP on the web app, or audit log (not in scope).
- The `session.revoked` events are published but nothing consumes them yet (Phase 6).
- `next dev` is used by one integration test (`web-auth.int.test.ts`, about 15 s, needs ports and a free `apps/web/.next`); monitor its stability when Phase 2 CI is eventually enabled. If it proves flaky, make it build and use `next start`.
- The optional Compose `apps` profile was verified on `http://localhost:3000` in the owner's browser. The environment-specific `Secure`/`__Host-` cookie caveat in D42 did not block the owner's reported test; still test the production HTTPS topology before deployment.

### 7.7 Owner verification checklist

Owner-run verification record is in §7.9. Results:

1. `pnpm install --frozen-lockfile`, PostgreSQL 17, Redis 7 and `.env`: **Passed**.
2. `pnpm db:migrate:deploy`, `pnpm db:migrate:status`, and scratch-database `migrate:dev` drift check: **Passed**; both migrations applied, status up to date, no drift/new migration proposed.
3. Lint, format check and typecheck: **Passed**. All 228 tests passed with `--testTimeout=20000`. The default timeout remains borderline for spawn-heavy tests; see §7.9.
4. Manual browser acceptance: **Completed**. Registration/login, reload persistence, protected-page redirect, generic invalid-credential message, profile display-name and presence-colour changes, second-session listing/revocation, password-change revocation, logout/back-button protection, and the current-session indicator were checked. The current-session badge was made visible by separating the truncated user-agent text from the non-shrinking badge.
5. Optional Docker `apps` profile: **Passed**. API, web, collab and migration images built; containers started; migration exited 0 with no pending migrations; owner verified the application in the browser; `GET http://localhost:4000/ready` returned HTTP 200 with `postgres: healthy` and `redis: healthy`.
6. D41–D47: **Accepted by the owner on 2026-11-13** (DECISIONS.md). D43's trusted-proxy design is accepted; actual production proxy/hosting selection remains open (U10).
7. Phase 2 GitHub Actions CI: **Deferred by explicit owner instruction; not run and not passed.** Do not mark Phase 2 CI as passed until a real workflow run succeeds.

### 7.8 Notes for Phase 3

New protected endpoints go inside the authenticated scope in `apps/api/src/routes/auth.ts` (hook `requireAuth`, user via `authOf(request)`), with per-route `config.rateLimit`; add the shared permission function (D23) rather than ad-hoc checks. Use `Dependencies.clock` for every time-based decision. The web `(app)` route group and `requireUser()` are the pattern for protected pages. Phase 3 adds its tables in a new migration; the readiness check will then require that migration automatically.

### 7.9 Owner verification record (2026-11-13)

Environment: Windows laptop, Git Bash/Windows terminal, Node.js 24.18.0, pnpm 12.18.0, Docker 29.9.2, PostgreSQL 17 and Redis 7 from the local Compose file.

**Owner-run Phase 2 acceptance checks are complete, except Phase 2 GitHub Actions CI, which the owner explicitly deferred. Final Phase 2 sign-off has not yet been recorded.**

| Verification area | Result | Evidence / qualification |
|---|---|---|
| Install and local infrastructure | **Passed** | `pnpm install --frozen-lockfile` clean; PostgreSQL (host 5433) and Redis (6379) healthy; `.env` present |
| Prisma migration and drift | **Passed** | `migrate deploy`: no pending migrations; `migrate status`: up to date. Scratch database `conote_scratch`: `migrate:dev` applied both migrations from empty without proposing a new migration; second run reported "Already in sync" |
| Lint, format and typecheck | **Passed** | Owner reports all passed |
| Automated tests | **Passed with timeout qualification** | 17 files / 228 tests passed with `--testTimeout=20000`. The default 5-second timeout was borderline for spawn-heavy tests; see Findings |
| Manual browser acceptance | **Passed** | Registration/login, reload persistence, signed-out protected-page redirect, generic wrong-password/unknown-email response, profile display-name and presence-colour changes, header update after reload, second-session listing/revocation, password-change revocation of other sessions, logout/back-button protection, and current-session indicator verified by owner |
| Current-session indicator | **Fixed and verified** | API returned `current: true`; DTO already declared `current: boolean`. UI issue was truncation on the paragraph containing both the long user-agent and badge. The user-agent is now truncated independently and the `This device` badge uses `shrink-0`; owner confirmed the indicator appears |
| Docker app images and startup | **Passed** | `docker compose -f infra/docker-compose.yml --profile apps up --build`: API, web, collab and migrate images all built; PostgreSQL and Redis healthy; migration container exited with code 0 and reported no pending migrations; API, web and collab started |
| Docker application browser check | **Passed** | Owner confirmed the Docker-hosted application had already been verified in the browser |
| API readiness in Docker | **Passed** | `curl.exe -i http://localhost:4000/ready` returned HTTP 200: `{"status":"ready","service":"api","dependencies":{"postgres":"healthy","redis":"healthy"}}` |
| D41–D47 owner decisions | **Accepted** | All seven decisions explicitly accepted by the owner on 2026-11-13; details and Option A selections are recorded in DECISIONS.md |
| GitHub Actions CI for Phase 2 | **Deferred / not run** | Owner explicitly chose to hold GitHub CI for now. This is not a pass and must not be represented as one |
| Production hosting / proxy deployment | **Open** | D43 design accepted, but provider/topology selection remains U10 and must be completed before production deployment |

#### Findings and qualifications retained from the verification process

1. **Stale Phase 1 page shadowed the Phase 2 home page.** `apps/web/src/app/page.tsx` (the Phase 1 placeholder) existed alongside `apps/web/src/app/(app)/page.tsx`; both resolve to `/`, and the placeholder won. Three tests in `web-auth.int.test.ts` failed (unauthenticated `/` returned 200 instead of redirecting; the signed-in page lacked the welcome text). The stub was removed with `git rm` and `apps/web/.next` was deleted; the file then passed 7/7. Ensure the deletion is included in the Phase 2 change set.
2. **Default test timeout is borderline on this machine.** Earlier default runs encountered timeout failures in spawn-heavy tests (`tests/boundaries.test.ts` and `tests/startup.test.ts`). In isolation the boundaries test took about 4.1 seconds of its 5-second limit. All 228 tests passed with `--testTimeout=20000`. No repository timeout change is recorded here; decide whether to adjust it before relying on CI.
3. **Development environment setup:** the root `package.json` has no `dev` script; run `pnpm dev:api` and `pnpm dev:web` in separate terminals (`dev:collab` is not needed for Phase 2). Next.js does not automatically read the root `.env`; the local workaround was `apps/web/.env.local` with `APP_URL` and `API_INTERNAL_URL`. Decide whether to document this or change the development script.
4. **Network binding:** the API was observed listening on all network interfaces during development. Review exposure and proxy configuration before production.
5. **Production reverse proxy:** D43's trusted-address-list design is accepted, but the actual proxy address list and production topology must be configured for the selected hosting environment (U10).

#### Remaining before Phase 2 final sign-off

- The owner deferred GitHub Actions CI. Before treating Phase 2 as fully closed under a process that requires CI, run the Phase 2 workflow and record its actual result. Until then, CI remains **deferred/not run**, not passed.
- Decide whether to raise the default timeout for spawn-heavy tests and document/fix root `.env` loading for `pnpm dev:web`.
- Select the production hosting and reverse-proxy topology (U10) before deployment. This does not block local Phase 2 feature verification, but is a production deployment requirement.
- Record the owner's explicit final Phase 2 acceptance before starting Phase 3.

