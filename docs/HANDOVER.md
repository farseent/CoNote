# CoNote – Handover

**Last updated:** 2026-11-12

**Current phase:** Phase 1 – Project Setup and Infrastructure. **Phase 1a infrastructure verification is complete based on owner-reported evidence. Phase 1b S1–S11 have now been executed successfully (11/11 PASS). Root pnpm check also passed after the spike changes on 2026-11-12 (9 test files, 59 tests). The owner explicitly approved U1 (Node.js 24) and U2 (TypeScript 5.9.3). Final cross-document reconciliation and owner review of remaining limitations are in progress.** The owner selected Phase 1b before Phase 2 (D33).

**Next phase after the current task:** Phase 2 – Authentication and User Management. **Not started and blocked** until Phase 1 closure is explicitly approved by the owner after reviewing the reconciled Phase 1b evidence.

Read `CLAUDE.md` first. This file is the source of truth for current project status.

## 1. Current status

| Area | Current state |

|---|---|

| Repository | pnpm monorepo with `apps/web`, `apps/api`, `apps/collab`, `packages/db`, `packages/shared`, `packages/editor`; root scripts, CI, Dockerfiles and local Compose configuration are present |

| Product features | None implemented yet: no authentication, workspaces, page management, rich-text editor, production Yjs collaboration, presence, comments or version history |

| API | Fastify foundation and operational `/health` and `/ready` endpoints implemented |

| Collaboration server | Hocuspocus shell and operational endpoints implemented. It deliberately rejects every document connection; this is not a working collaboration service (D38) |

| Database | Prisma 7.10.1 configured with an intentionally empty baseline migration. No application models or production document persistence exist |

| Local infrastructure | PostgreSQL 17 and Redis 7 Compose services reported healthy. PostgreSQL host port 5433 maps to container port 5432; Redis host port 6379 |

| Phase 1a verification | Owner reports `pnpm check` passed, 59 tests passed (47 unit + 12 integration), migrations deployed and up to date, Docker Compose PostgreSQL/Redis healthy, GitHub Actions CI passed, and the web shell was checked in a browser |

| Docker app images | **Not verified**: do not infer that the optional `--profile apps` image build passed from the successful Compose infrastructure startup |

| Phase 1b spike | Harness and report at `spikes/collab-poc/` and `docs/spikes/phase-1-collab-spike.md`; S1–S11 executed, 11/11 PASS. Root `pnpm check` passed; remaining evidence reconciliation and owner review are in progress |

| Phase 2 | Not started; blocked until Phase 1 closure and explicit owner approval |

### Decisions and open items

- **D33:** Owner selected Phase 1b before Phase 2. D33 is recorded as accepted.

- **U1 / D16:** Node.js 24 was explicitly approved by the project owner on 2026-11-12. The spike and root checks used Node.js 24.18.0.

- **U2 / D17:** TypeScript 5.9.3 was explicitly approved by the project owner on 2026-11-12.

- **U3 / U4:** Empirical evidence is available from S1–S7. These questions are only partially resolved: store-on-unload, direct concurrent row-lock behaviour, stale awareness after a Hocuspocus instance crash and awareness expiry values remain unverified.

- **U5 / V8:** Resolved by Phase 1a evidence: Prisma client generation, real database connectivity, successful `migrate deploy`, and `migrate status` reporting up to date.

- **U7 / D37:** Object storage/MinIO is deliberately omitted from Phase 1 Compose; revisit in Phase 4.

- **U13:** Explicit production recovery after Redis Pub/Sub message loss remains a Phase 9 decision. Redis reconnection alone is not proof of reconvergence.

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