# CoNote – Handover

**Last updated:** 2026-11-11
**Current phase:** Phase 0 – Documentation and Architecture (documentation corrections prepared; **awaiting owner review and approval**)
**Next phase:** Phase 1 – Project Setup and Infrastructure (**not started; do not start without the owner's approval**)

Read `CLAUDE.md` first. This file is the single place for current status; other documents describe the design.

## 1. Status summary

| Item | Status |
|---|---|
| Application code | None exists (by design in Phase 0) |
| Repository | Documentation files only: `README.md`, `CLAUDE.md`, `docs/*` |
| Phase 0 deliverables | All 12 documents written (§2) |
| Owner-approved decisions | D1–D10 (explicit approval), D28 (roadmap structure) |
| Proposed decisions awaiting sign-off | D15–D27, D29–D32 (§4) |
| Unresolved decisions | U1–U13 (§5) |
| Unverified assumptions | V1–V14 (§6) |
| Next action | Owner reviews Phase 0 and approves (or requests changes), then says "start Phase 1" |

## 2. Phase 0 work completed

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

## 3. Key architectural conclusions

1. **y-websocket + Redis is not a scalable architecture** by itself; the reference server is in-memory and its README says it cannot be scaled easily. **Hocuspocus + its Redis extension** is the approved choice (D1, D2). The Redis extension does not persist data and every instance handles every message, so it adds availability and connection capacity, not per-document CPU capacity.
2. **Persistence design (D15):** append-only diff updates, compacted state, immutable snapshots; all writes per page under a row lock; PostgreSQL is the only durable store (D14). Guarantees are limited to **G1–G7**; zero data loss is never claimed. Redis Pub/Sub misses are not replayed; an explicit Phase 9 recovery path is required before live reconvergence can be claimed.
3. **Package findings:** Prisma CLI `latest` is an 8.x release candidate while the client is 7.10.1 → both pinned to 7.10.1 (D18); Hocuspocus Redis extension depends on ioredis 5.6 → pinned 5.6.x (D19); Tiptap 3 Collaboration needs `@tiptap/y-tiptap` (D20); TypeScript `latest` is 7.x but the toolchain was not verified against it → 5.9.3 (D17); Node 24 is already in Maintenance LTS and Node 26 is only weeks into LTS → Node 24 proposed (D16, U1).
4. **Design choices made during Phase 0 that go beyond your explicit approvals** (all Proposed; please review): collaboration JWT signed with EdDSA so collab holds public keys only (D22); permission resolution rules and Admin limits (D23); soft delete with 30-day purge (D24); version create/restore as WebSocket commands, list/read as REST (D32); awareness identity binding; no workspace-level realtime channel in the MVP (D32); link-based invitations with the token in the URL fragment (D30).

## 4. Decisions needing owner sign-off

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

## 5. Unresolved decisions

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

## 6. Unverified assumptions (V1–V14)

Tracked in `docs/ARCHITECTURE.md` §18. The Phase 1 spike is designed to resolve V1–V6, V11–V14 (store-on-unload and debounce options, store hook for Redis-originated updates, awareness behaviour, Redis outage detection/recovery feasibility, token handling, close codes, stateless messages, awareness identity enforcement, limits). Redis reconnection alone is not accepted as proof of reconvergence. V7 (Next.js rewrite forwarding) is Phase 2; V8 (Prisma monorepo setup) Phase 1; V9 (Yjs binding package) Phase 5; V10 (server-side restore transaction) Phase 8. **Do not treat any V item as fact until it is verified and the docs are updated.**

## 7. Documentation corrections prepared for owner review

The following design defects were corrected in the Phase 0 document set. These are documentation changes only; no implementation or tests have been run.

1. **Redis outage:** G5 no longer promises automatic reconvergence after Redis returns. Redis Pub/Sub message loss is explicit; Phase 9 must implement and test stale-document detection and resynchronization. Added U13.
2. **Workspace owner invariant:** clarified that the partial unique index enforces at most one owner only. A deferred PostgreSQL constraint trigger is required to enforce at least one owner at commit; create/transfer must be atomic.
3. **Readiness:** API liveness/readiness, PostgreSQL health and Redis degraded status are separate. Redis alone does not make the API unready; Redis-dependent operations have explicit scoped failure/fallback rules.
4. **Page tree concurrency:** structural mutations serialize on a workspace-scoped transaction lock; a composite `(workspaceId,parentId)` foreign key prevents cross-workspace parent links; race tests cover cycles and concurrent moves.
5. **Version restore:** Phase 8 requires a durable cross-instance restore barrier, draining/committing pre-barrier updates, PRE_RESTORE snapshot before applying restore, atomic failure behaviour and client resynchronization.

## 8. Consistency review (performed at the end of Phase 0)

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

## 9. Owner checklist before Phase 1

1. Review the documents; approve or request changes (especially §4 Proposed decisions and the design choices in §3.4).
2. Confirm the repository: name/location, GitHub, and that CI will be GitHub Actions (or say otherwise).
3. Confirm the development machine has Docker and can run Node.js 24 (or decide U1 now).
4. Decide whether `README.md`/`CLAUDE.md` go at the repository root and `docs/*` under `docs/` (as written).
5. Optionally decide U12 (license) and U9 (external guests out of scope) now.

## 10. Instructions for starting Phase 1

**Do not start until the owner approves Phase 0 and says to begin.** Then follow `docs/IMPLEMENTATION_PLAN.md` Phase 1 and the checklist below.

### Order of work

1. Restate the Phase 1 scope, acceptance criteria AC-1.1 … AC-1.11 and the open items U1, U2, U5, U3, U4, V1–V6, V8, V11–V14 to the owner.
2. **Repository and tooling:** create the monorepo structure (`apps/*`, `packages/*`, `docs/`, `infra/`), add `README.md`, `CLAUDE.md`, `docs/*`; `pnpm-workspace.yaml`; `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`); `.nvmrc` and `engines`; ESLint with boundary rules (and the deliberate-violation test, AC-1.3); Prettier; Vitest config.
3. **Pin dependencies** exactly per `docs/PROJECT_MASTER.md` §6; install on Node 24 with `--frozen-lockfile` semantics; record any version deviation in DECISIONS.md (AC-1.1, AC-1.6). Resolve U1, U2 and pick the exact `@tiptap/y-tiptap` version.
4. **Infrastructure:** Docker Compose for PostgreSQL 17, Redis 7.x, S3-compatible storage; check MinIO's current distribution/licensing (U7); `.env.example`; document the steps (AC-1.4).
5. **Application shells:** `web` starter page, `api` with `OPS-01`/`OPS-02`, `collab` process shell, empty package entry points (AC-1.5).
6. **Prisma 7 setup** per official docs in the pnpm monorepo; record generator output, driver adapter and config (U5, V8, AC-1.7).
7. **CI** (GitHub Actions unless the owner says otherwise): install, lint, typecheck, test.
8. **Spike** in `spikes/collab-poc/` (outside the workspace build): two Hocuspocus instances on ports 4100/4101 + Redis + PostgreSQL; run scenarios **S1–S11** from the plan; record pass/fail/observation, exact versions and environment in `docs/spikes/phase-1-collab-spike.md` (AC-1.8).
9. **Close the loop:** for each of U3, U4, V1–V6, V11–V14, resolve with evidence or re-record as unresolved with reasons; write the architectural implications into DECISIONS.md, ARCHITECTURE.md and WEBSOCKET_PROTOCOL.md; resolve U1, U2, U5 (AC-1.9, AC-1.10).
10. **Remove the spike** (or archive it outside builds), confirm no production collaboration code exists (AC-1.11).
11. Run the Definition of Done (`docs/IMPLEMENTATION_PLAN.md` §1), report against every acceptance criterion with evidence, update this file, **stop and wait for approval.**

### Do not do in Phase 1

No authentication, database models/migrations, editor code, real collaboration features, comments or versions. No "temporary" shortcuts that would survive into later phases. No performance claims.

## 11. Change log

| Date | Change |
|---|---|
| 2026-11-11 | Phase 0 documentation created in four batches; initial consistency review performed; this handover written. |
| 2026-11-11 | Corrected Redis outage/recovery, owner invariant, readiness, page-tree concurrency and version-restore design; awaiting owner review. |
