# CoNote – Technical Decisions

**Status:** Phase 1a infrastructure implemented; Phase 1b collaboration spike outstanding and owner-selected before Phase 2. U5/V8 resolved by reported implementation evidence; U1/U2 owner sign-off pending.
**Last updated:** 2026-11-12
**Owner:** Project owner (approvals) / Claude (drafting)

This is the permanent decision register for CoNote. Decision IDs (`D#`) and unresolved-question IDs (`U#`) are **permanent**: they are never renumbered or reused. A changed decision is recorded by adding a new decision that supersedes the old one and updating the old one's status.

## Status legend

| Status | Meaning |
|---|---|
| **Accepted** | Explicitly approved by the project owner. |
| **Accepted (requirement)** | Stated by the project owner as a project requirement. |
| **Proposed** | Drafted during Phase 0 and included in the Phase 0 package. Treated as the working plan unless the owner changes it. |
| **Unresolved** | Not yet decided. Listed in the "Unresolved decisions" section. |
| **Superseded** | Replaced by a later decision (none yet). |

## Decision index

| ID | Title | Status |
|---|---|---|
| D1 | Collaboration server: Hocuspocus | Accepted |
| D2 | Multi-instance sync: Redis fan-out | Accepted |
| D3 | Separate API service (`apps/api`) | Accepted |
| D4 | API framework: Fastify + Zod | Accepted |
| D5 | Custom authentication (Argon2id, DB sessions, httpOnly cookies) | Accepted |
| D6 | Same-origin proxy through Next.js rewrites | Accepted |
| D7 | Short-lived collaboration JWTs | Accepted |
| D8 | Comment anchors via Yjs Relative Positions | Accepted |
| D9 | Version restore as a new transaction | Accepted |
| D10 | S3-compatible image storage | Accepted |
| D11 | pnpm monorepo, no Turborepo | Accepted (requirement) |
| D12 | TypeScript strict mode | Accepted (requirement) |
| D13 | Dependency pinning and Node.js requirements policy | Accepted (requirement) |
| D14 | PostgreSQL is the durable source of truth; Redis is never permanent storage | Accepted (requirement) |
| D15 | Yjs persistence model: incremental updates + compacted state + snapshots | Proposed |
| D16 | Node.js 24 LTS baseline | Proposed (see U1) |
| D17 | TypeScript 5.9.x pin | Proposed (see U2) |
| D18 | Prisma 7.10.x pin (CLI and client together) | Proposed (see U5) |
| D19 | ioredis 5.6.x pin | Proposed |
| D20 | Tiptap 3.x + Yjs 13.x + `@tiptap/y-tiptap` | Proposed |
| D21 | Collab server accesses PostgreSQL directly | Proposed |
| D22 | Collaboration JWT format, revalidation and revocation | Proposed (refines D7) |
| D23 | Roles and effective-permission resolution | Proposed |
| D24 | Soft delete for pages | Proposed |
| D25 | API security baseline | Proposed |
| D26 | Testing toolchain | Proposed |
| D27 | Frontend baseline: Next.js 16, React 19, Tailwind 4 | Proposed |
| D28 | Roadmap structure (Phase 1 spike; Phases 5 and 6 separate) | Accepted |
| D29 | Identifier strategy | Proposed |
| D30 | Invitation token handling | Proposed |
| D31 | API versioning and response envelope | Proposed |
| D32 | Application-level realtime events | Proposed |
| D33 | Phase 1 delivered in two parts; collaboration spike deferred (Phase 1b) | Accepted (owner chose Phase 1b before Phase 2) |
| D34 | Operational endpoints return plain JSON with a `service` field | Proposed (Phase 1) |
| D35 | Baseline migration is empty; readiness "schema-compatible" definition | Proposed (Phase 1) |
| D36 | Internal packages compile to `dist`; apps resolve packages by built output | Proposed (Phase 1) |
| D37 | Object storage (MinIO) not in Docker Compose in Phase 1 | Proposed (Phase 1) |
| D38 | Collab shell accepts the WebSocket handshake but rejects every document connection | Proposed (Phase 1) |
| D39 | Tooling versions pinned beyond D11–D13 | Proposed (Phase 1) |
| D40 | Environment validation scope and rules | Proposed (Phase 1) |

---

## Accepted decisions

### D1 – Collaboration server: Hocuspocus

- **Status:** Accepted
- **Context:** The reference `y-websocket` server keeps documents in memory and its own README states it cannot be scaled easily. The `y-redis` alternative is labelled beta and is dual-licensed (AGPL or proprietary). A custom server would duplicate what Hocuspocus already provides.
- **Decision:** Use **Hocuspocus 4.x** (`@hocuspocus/server`, `@hocuspocus/provider`) as the Yjs collaboration server and client provider. Yjs (CRDT) remains the synchronization model.
- **Rationale:** MIT licensed; authentication and read-only hooks; a Redis extension for multi-instance operation; maintained alongside Tiptap.
- **Consequences:**
  - Hocuspocus is Yjs-compatible. **Wire compatibility with the plain `y-websocket` client is not assumed or required.** The client must use `HocuspocusProvider`.
  - Hocuspocus 4 requires Node.js >= 22 (from package metadata) and uses web-standard `Request`/`Headers` objects in hooks.
  - If Hocuspocus proves unsuitable in the Phase 1 spike, the fallback is a custom server on `y-protocols` (recorded as a new decision that supersedes D1).
- **References:** Hocuspocus docs (hooks, authentication, Redis); `y-websocket` and `y-redis` READMEs. See ARCHITECTURE.md §17.

### D2 – Multi-instance sync: Redis fan-out

- **Status:** Accepted
- **Context:** Several collab instances must serve clients of the same document.
- **Decision:** Use the **Hocuspocus Redis extension** (`@hocuspocus/extension-redis`) as the initial multi-instance strategy. Redis carries Yjs updates and awareness between instances. Sticky per-document routing is documented as a possible future optimization, not implemented initially.
- **Documented limitations (from the official Redis extension docs):**
  - The Redis extension **does not persist data**; persistence is a separate responsibility (D14, D15).
  - **All messages are handled on all instances**, so adding instances behind Redis adds connection capacity and availability, not CPU relief per document.
  - When a document is loaded on one instance while open on another, the load waits for the other instance's current state, bounded by `awaitInitialSyncTimeout` (default 1000 ms).
  - Storing a document is mutually exclusive across instances (an instance that is storing a document blocks the others).
- **Consequences:** Behaviour under Redis failure, duplicate persistence and awareness propagation must be verified in the Phase 1 spike (U3, U4) before Phase 6 relies on it.
- **References:** Hocuspocus Redis extension docs. See ARCHITECTURE.md §9.

### D3 – Separate API service

- **Status:** Accepted
- **Decision:** REST API and application services live in a separate Node.js service, `apps/api`. Next.js (`apps/web`) does not contain business logic or database access.
- **Consequences:** Three deployable services: `web`, `api`, `collab` (ARCHITECTURE.md §4).

### D4 – API framework: Fastify + Zod

- **Status:** Accepted
- **Decision:** Fastify 5 with Zod 4 validation (via `fastify-type-provider-zod`). Request and response schemas are defined in `packages/shared` and reused by the web client.
- **Consequences:** `fastify-type-provider-zod` 7.x has peer requirements `fastify ^5.5` and `zod >= 4.1.5` (package metadata, 2026-11-11); versions in PROJECT_MASTER.md §6 satisfy them.

### D5 – Authentication

- **Status:** Accepted
- **Decision:** Custom authentication:
  - Passwords hashed with **Argon2id** (`argon2` package). Initial parameters follow the OWASP Password Storage Cheat Sheet baseline (m = 19456 KiB, t = 2, p = 1) and are re-tuned on target hardware in Phase 2.
  - **Database-backed sessions.** The session token is 32 random bytes, base64url-encoded. Only a **SHA-256 hash** of the token is stored.
  - Token delivered in a **host-only `HttpOnly` cookie** (attributes in ARCHITECTURE.md §10).
  - Initial lifetimes: **7 days idle** (sliding) and **30 days absolute**. Tunable.
- **Consequences:** The Prisma `Session` model is required (DATABASE_SCHEMA.md). Users can list and revoke sessions.
- **References:** OWASP Password Storage, Session Management and CSRF Prevention cheat sheets.

### D6 – Same-origin proxy through Next.js rewrites

- **Status:** Accepted
- **Decision:** The browser talks only to the Next.js origin for REST. Next.js `rewrites()` forward `/api/*` to the API service (`API_INTERNAL_URL`). The session cookie is therefore host-only on the web origin. Server-side rendering code calls the API directly at `API_INTERNAL_URL` and forwards the cookie explicitly.
- **WebSocket exception:** WebSocket traffic does **not** go through Next.js rewrites. Browsers connect directly to the collab origin and authenticate with a collaboration JWT (D7), not cookies.
- **Consequences:** Phase 2 must verify, with tests, how the proxy forwards `Origin`, `Host`, `X-Forwarded-*` and `Set-Cookie` (these are not assumed). Configuration is documented in ARCHITECTURE.md §10.

### D7 – WebSocket authentication with short-lived JWTs

- **Status:** Accepted (details and refinements in D22)
- **Decision:** The API issues short-lived collaboration JWTs. The collab server authorizes every connection server-side and revalidates access when permissions change. Token expiry and revocation behaviour are documented in D22 and WEBSOCKET_PROTOCOL.md.

### D8 – Comment anchors via Yjs Relative Positions

- **Status:** Accepted
- **Decision:** Comment anchors are stored as **Yjs Relative Positions** (start and end, encoded). Comment threads and metadata live in PostgreSQL. Comments are **not** stored as ordinary editor content (no comment marks in the document).
- **Rationale:** Relative positions follow content as the document is edited concurrently. Because comments are created through REST, **commenters can comment over a read-only collaboration connection**.
- **Consequences:**
  - Anchors on deleted content must be handled ("detached" state).
  - Restoring a version replaces content and may detach anchors (D9, U8).
  - The editor must render highlights from comment data via editor decorations (Phase 8).
- **References:** Yjs Relative Positions API.

### D9 – Version restoration as a new transaction

- **Status:** Accepted
- **Decision:** Restoring a version is applied as a **new document transaction on top of existing history**; it does not rewind or delete history. A **pre-restore snapshot** of the current state is always created first. All previous snapshots are preserved. Active collaborators receive the restored state through normal Yjs synchronization and converge.
- **Consequences:** Restore is executed by the collab server (so it is serialized with live editing). Anchor handling is U8.

### D10 – Image storage

- **Status:** Accepted
- **Decision:** Images are stored in **S3-compatible object storage**: MinIO for local development if practical; an S3-compatible provider in production. Image storage sits behind a **storage adapter interface** in `apps/api` so it stays modular. Images are never stored in PostgreSQL.
- **Consequences:** Upload flow, limits and allowed types are U7. MinIO distribution/licensing status must be re-checked in Phase 1.

### D28 – Roadmap structure

- **Status:** Accepted
- **Decision:** Keep Phases 0–11. Phase 1 includes a **small disposable two-instance Hocuspocus + Redis + PostgreSQL proof of concept** that verifies cross-instance sync, awareness propagation, and persistence and recovery, and records the results and architectural implications. The complete collaboration feature is **not** built in Phase 1. **Phases 5 and 6 remain separate.**
- **Consequences:** See IMPLEMENTATION_PLAN.md Phase 1 and Phase 5/6 boundaries.

---

## Requirements-derived decisions

### D11 – pnpm monorepo, no Turborepo

- **Status:** Accepted (requirement)
- **Decision:** One repository using **pnpm workspaces** with this layout: `apps/web`, `apps/api`, `apps/collab`, `packages/db`, `packages/shared`, `packages/editor`. **Turborepo is not used initially**; plain pnpm workspace scripts are used until a measured need appears.
- **Module boundaries:** see ARCHITECTURE.md §5 (dependency rules enforced by lint).

### D12 – TypeScript strict mode

- **Status:** Accepted (requirement)
- **Decision:** All packages use `"strict": true` via a shared `tsconfig.base.json`. Additionally enabled: `noUncheckedIndexedAccess`. No `any` without a documented justification comment.

### D13 – Dependency pinning and Node.js requirements

- **Status:** Accepted (requirement)
- **Decision:**
  - Dependencies are pinned to **exact versions** in `package.json` (no `^` or `~` ranges); `pnpm-lock.yaml` is committed.
  - Node.js requirement is declared in `engines`, `.nvmrc`, Dockerfiles and CI, and documented in README.md.
  - Versions are chosen only after checking engine and peer-dependency metadata and official docs. Verified candidate versions and the verification date are in PROJECT_MASTER.md §6.
  - Version changes go through a decision update when they affect compatibility (e.g. Prisma, Hocuspocus, Tiptap, Yjs).
- **Note:** Version metadata was verified on **2026-11-11** against the npm registry (engines/peer dependencies). Runtime verification happens in Phase 1.

### D14 – PostgreSQL is durable truth; Redis is never permanent storage

- **Status:** Accepted (requirement)
- **Decision:**
  - PostgreSQL is the durable source of truth for **application data and collaborative document recovery**.
  - Redis holds only transient/coordination data (fan-out, locks, rate-limit counters, event pub/sub). Correctness must never depend on Redis data surviving.
  - **The project never claims zero data loss.** Persistence guarantees are defined in ARCHITECTURE.md §8 (G1–G7) and are claimed only after the corresponding tests in TESTING.md pass.

---

## Proposed decisions

### D15 – Yjs persistence model

- **Status:** Proposed
- **Context:** Storing the full document on every keystroke is explicitly rejected. Hocuspocus's Redis extension serializes stores across instances.
- **Decision (baseline design, to be validated by the Phase 1 spike):**
  1. **`DocumentUpdate`** – append-only rows holding *incremental* Yjs update binaries (diffs), ordered by a monotonically increasing sequence.
  2. **`DocumentState`** – one row per page holding the **compacted full state** (`foldedState`), the **persisted state vector** (coverage of the folded state plus all stored updates), and the highest update sequence folded into it (`foldedSeq`). It is also the per-page lock row.
  3. **`DocumentSnapshot`** – immutable full-state versions for version history (manual, automatic and pre-restore).
  4. **Write path:** on the collab server's debounced store hook, compute the diff between the live `Y.Doc` and the **last persisted state vector** and append it as one `DocumentUpdate` row. Never write the whole document per edit.
  5. **Compaction:** merge updates into `DocumentState` and delete the folded rows in one transaction, when a threshold is exceeded or a document unloads.
  6. **Recovery:** load `DocumentState`, apply `DocumentUpdate` rows with a higher sequence, in order.
- **Initial tunables (not performance claims; adjusted using spike and Phase 9 measurements):** store debounce 2000 ms, max debounce 10000 ms (Hocuspocus defaults, to be confirmed), compaction after 200 update rows or on unload.
- **Consequences:** Models and columns in DATABASE_SCHEMA.md; guarantees G2–G4 in ARCHITECTURE.md; open verification items U3. Authorship tracking is through `ActivityLog` (see ARCHITECTURE.md §13).

### D16 – Node.js 24 LTS baseline

- **Status:** Proposed
- **Context (as of 2026-11-11, per Node.js release-schedule sources):** Node 22 is in Maintenance LTS until 2027-04-30. Node 24 entered Maintenance on 2026-10-20 with end of life 2028-04-30. Node 26 became Active LTS on 2026-10-28 (end of life 2029-04-30) and is two weeks old. All planned dependencies accept Node 24 (Hocuspocus >= 22; Prisma ^20.19 / ^22.12 / >= 24; Vitest ^22.12 / ^24 / >= 26; Next.js >= 20.9).
- **Decision:** Develop and deploy on **Node.js 24 LTS** (latest 24.x patch, pinned in `.nvmrc`/Docker). Re-evaluate Node 26 later (U1).
- **Rationale:** Mature native-module ecosystem (`argon2`) and support through April 2028, avoiding a runtime that is only weeks into LTS.

### D17 – TypeScript 5.9.x

- **Status:** Proposed
- **Context:** The npm `latest` tag for TypeScript is 7.0.2 (2026-11-11). Prisma's requirement is TypeScript >= 5.4. Compatibility of the rest of the toolchain (Next.js type checking, Fastify and Zod types, ESLint tooling) with 7.x was **not verified** in Phase 0.
- **Decision:** Pin **TypeScript 5.9.3** initially. Revisit 6.x/7.x as a controlled upgrade (U2).

### D18 – Prisma 7.10.x

- **Status:** Proposed
- **Context:** On 2026-11-11 the npm `latest` tag for `@prisma/client` is 7.10.1, but the `latest` tag for the `prisma` CLI points to a release candidate (8.0.0-rc.33). CLI and client versions must match.
- **Decision:** Pin **`prisma` 7.10.1 and `@prisma/client` 7.10.1** (and `@prisma/adapter-pg` 7.10.1). Do **not** adopt the 8.x release candidate. PostgreSQL 17 is the target (supported by Prisma; 18 is also listed as supported).
- **Consequences:** Prisma 7 client/generator/driver-adapter/`prisma.config.ts` setup inside a pnpm monorepo is confirmed against official docs in Phase 1 (U5).
- **References:** Prisma system requirements; supported databases.

### D19 – ioredis 5.6.x

- **Status:** Proposed
- **Context:** `@hocuspocus/extension-redis` 4.8.0 depends on `ioredis ~5.6.1`. The newest `ioredis` on npm is 6.0.0.
- **Decision:** Pin **ioredis 5.6.x** everywhere (collab, api) so clients passed into the extension and the extension's own dependency use one major line. Upgrade only with Hocuspocus.

### D20 – Tiptap, Yjs and y-tiptap

- **Status:** Proposed
- **Decision:** Tiptap **3.33.1** packages (all pinned to the same version), Yjs **13.6.33**, `y-protocols` **1.0.7**, and `@tiptap/y-tiptap` as required by the Tiptap Collaboration extension's peer dependencies (`yjs ^13`, `@tiptap/y-tiptap ^3.0.7`).
- **Notes from official docs:** Disable StarterKit's built-in undo/redo when using the Collaboration extension (it has its own history handling). Use `@tiptap/extension-collaboration-caret` (the older `collaboration-cursor` name appears in some third-party guides and must not be used).
- **Consequence:** Tiptap docs still mention `y-prosemirror` in some install snippets; Phase 5 confirms exactly which Yjs binding package the pinned Tiptap version requires.

### D21 – Collab server uses PostgreSQL directly

- **Status:** Proposed
- **Decision:** `apps/collab` reads and writes `DocumentUpdate`, `DocumentState`, `DocumentSnapshot` and looks up effective permissions and session validity through `packages/db`. The API does not proxy Yjs traffic. The REST API reads snapshots but does not write collaborative document content.
- **Rationale:** One fewer network hop and no distributed transaction between services. Permission logic is shared as pure functions in `packages/shared`.

### D22 – Collaboration JWT, revalidation and revocation (refines D7)

- **Status:** Proposed
- **Token:**
  - Signed by the API using **EdDSA (Ed25519)** via `jose`; the collab server holds **public keys only** (so a compromised collab server cannot mint tokens). A `kid` header supports key rotation.
  - Claims: `iss` (`conote-api`), `aud` (`conote-collab`), `sub` (user id), `pid` (page id), `sid` (session id), `jti`, `iat`, `exp`.
  - **TTL: 60 seconds**, used only for the connection handshake. Issued by `POST /api/v1/pages/:pageId/collab-token` for a page the user can read.
  - The role is **not** trusted from the token. The collab server loads the authoritative effective role and session validity from PostgreSQL on connect.
- **Expiry behaviour:** Token expiry does **not** terminate an established connection. Clients obtain a fresh token for every (re)connection.
- **Revocation:** (1) The API publishes access-change events on a Redis channel (session revoked, member removed or role changed, page permission changed); collab instances downgrade (`readOnly`) or close the affected connections. (2) Because Redis pub/sub delivery is at-most-once, collab instances also **revalidate every open connection periodically** (initial default 60 s). The maximum exposure after revocation is therefore bounded by event delivery or the revalidation interval, whichever applies; this is a target to be verified by permission tests, not a proven figure.
- **Alternatives considered:** HS256 shared secret (simpler, but collab could mint tokens).
- **References:** `jose` library docs; Hocuspocus authentication guide.

### D23 – Roles and effective-permission resolution

- **Status:** Proposed
- **Workspace roles:** `OWNER`, `ADMIN`, `EDITOR`, `COMMENTER`, `VIEWER`. Exactly one `OWNER` per workspace (ownership can be transferred).
- **Page access roles (overrides):** `NONE`, `VIEWER`, `COMMENTER`, `EDITOR`, stored per user per page.
- **Resolution for user U on page P (first match wins):**
  1. U is `OWNER` or `ADMIN` of P's workspace → full access (cannot be restricted).
  2. A page override for U on P.
  3. The override for U on the nearest ancestor page (walking `parentId` upwards).
  4. U's workspace role mapped to the same-named page capability (`EDITOR`, `COMMENTER`, `VIEWER`).
  5. Otherwise no access.
  `NONE` denies access. Non-members of the workspace never have access (external guests are out of scope, U9).
- **Capabilities** (capability matrix in PROJECT_MASTER.md §5): `VIEWER` reads; `COMMENTER` reads and comments; `EDITOR` reads, comments, edits, creates child pages, moves and deletes pages; `ADMIN`/`OWNER` additionally manage members, invitations, page permissions and workspace settings (only `OWNER` deletes the workspace or transfers ownership). Only the `OWNER` may grant or revoke `ADMIN`; Admins manage Editor/Commenter/Viewer members and may remove only non-Admin members.
- **Consequence:** The resolution function lives in `packages/shared` as a pure function and is unit-tested exhaustively; API and collab both call it.

### D24 – Soft delete for pages

- **Status:** Proposed
- **Decision:** Deleting a page sets `deletedAt` on the page and its descendants (soft delete) and removes it from normal views. Restore is possible by an `EDITOR` or higher until a purge job permanently deletes it (initial retention 30 days, tunable). Document updates and snapshots are removed on purge via cascade.

### D25 – API security baseline

- **Status:** Proposed
- **Decision:** `@fastify/helmet`, `@fastify/cors` (explicit allow-list of origins), `@fastify/rate-limit` (Redis-backed counters; stricter limits on auth and invitation endpoints), `@fastify/cookie`. State-changing requests require a JSON content type and a validated `Origin` header (CSRF defence in depth on top of `SameSite=Lax`). All inputs validated with Zod. Details in ARCHITECTURE.md §10 and the security sections of API_CONTRACTS.md.

### D26 – Testing toolchain

- **Status:** Proposed
- **Decision:** **Vitest** (unit, integration, API, database, WebSocket tests; Vitest 5.1 requires Node ^22.12 / ^24 / >= 26), **Playwright** (multi-browser and end-to-end), and a custom **Node.js Yjs client harness** for concurrent-editing, reconnection, recovery and load tests. Databases for tests run in Docker. No performance numbers are asserted until measured.

### D27 – Frontend baseline

- **Status:** Proposed
- **Decision:** Next.js **16.4.6** (App Router), React **19.3.1**, Tailwind CSS **4.3.5**. Next.js 16 requires Node >= 20.9 and React ^19 (package metadata).

### D29 – Identifier strategy

- **Status:** Proposed
- **Decision:** Primary keys are UUIDs generated by Prisma (`@default(uuid())`, stored as PostgreSQL `uuid`). `DocumentUpdate` uses a `BigInt` auto-increment sequence for ordering. Public URLs use the page/workspace UUID.

### D30 – Invitation token handling

- **Status:** Proposed
- **Decision:** Invitation tokens are 32 random bytes (base64url), **single use**, **bound to the invited email address**, expire after **7 days** (tunable), and only a **SHA-256 hash** is stored. The raw token appears only in the invitation link. Acceptance requires an authenticated user whose email matches the invitation. Delivery by link first; email delivery is U6.

### D31 – API versioning and response envelope

- **Status:** Proposed
- **Decision:** REST routes are prefixed `/api/v1`. Every response uses one envelope: success `{ "success": true, "data": ..., "meta"?: ... }`; error `{ "success": false, "error": { "code", "message", "details"?, "requestId" } }`. Full specification in API_CONTRACTS.md.

### D32 – Application-level realtime events

- **Status:** Proposed
- **Decision:** Document-scoped application events (e.g. access revoked, version restored, comments changed) travel as **Hocuspocus stateless messages** on the document connection, clearly separated from Yjs sync and awareness traffic. There is **no workspace-level realtime channel in the MVP**; the page tree and member lists refresh by re-fetching (on focus and on user actions). Join/leave notifications are derived from awareness changes on the client.
- **Client-to-server commands:** creating a manual snapshot and restoring a version (`version.create`, `version.restore`) use the same stateless mechanism, authorized by the connection's read-write role, because they must be serialized with live editing by the collab server (D9, D21). Listing and reading versions are REST.
- **Consequence:** The message catalog is in WEBSOCKET_PROTOCOL.md. A workspace-level channel may be added later as a new decision.

---

### D33 – Phase 1 delivered in two parts; collaboration spike deferred (Phase 1b)

`docs/IMPLEMENTATION_PLAN.md` Phase 1 includes a disposable collaboration spike (S1–S11, AC-1.8–1.10) and the resolution/qualification of U3/U4/V1–V6/V11–V14. The owner's original Phase 1 task list covered infrastructure only, so delivery was split into Phase 1a and Phase 1b. **Phase 1a is complete based on the owner-reported evidence in HANDOVER.md; Phase 1b remains outstanding. The owner has explicitly chosen to run Phase 1b before Phase 2.** Phase 2 must not start until the spike is completed, its results reviewed, and the owner separately approves Phase 2.

### D34 – Operational endpoints return plain JSON with a `service` field

`GET /health` returns `{status:"ok",service}` and `GET /ready` returns `{status,service,dependencies:{postgres,redis}}` on both API and collab (and `/health` on web). They are not wrapped in the D31 envelope (API_CONTRACTS §13 says they are not under `/api/v1`). The `service` field is an addition to the contract. API readiness is `not_ready` (503) only when PostgreSQL is not healthy; collab readiness is `degraded` (200) when only Redis is down.

### D35 – Baseline migration is empty; readiness "schema-compatible" definition

`packages/db/prisma/schema.prisma` has no models in Phase 1 (the first models, User and Session, arrive in Phase 2). One baseline migration (`20261111000000_baseline`, SQL `SELECT 1;`) exists so that `prisma migrate deploy` has something to apply and the migration pipeline can be exercised in CI before real schema exists. "Schema-compatible" in readiness currently means: `_prisma_migrations` exists and contains no failed (unfinished, not rolled back) migration. It does **not** compare applied migrations with the migrations the running build expects; that must be added once real models exist (Phase 2).

### D36 – Internal packages compile to `dist`

`@conote/shared`, `@conote/db` and `@conote/editor` are built with `tsc` to `dist/` and export only `dist` (types and JS). Apps resolve them by package name, so `pnpm run build:packages` must run before app typecheck/tests/dev (the root `typecheck`, `test*` scripts do this). `@conote/db` build runs `prisma generate` first; the generated client lives in `packages/db/src/generated/` (git-ignored) and is compiled into `dist/generated`.

### D37 – Object storage not in Docker Compose in Phase 1

The plan lists S3-compatible storage (MinIO "if practical", U7). The owner's Phase 1 task list did not include it, no Phase 1–3 feature uses it, and MinIO's current official image distribution could not be verified. **U7 stays open**; add the storage service in Phase 4 after verifying distribution/licensing.

### D38 – Collab shell rejects every document connection

Hocuspocus accepts connections unless a hook refuses them. The Phase 1 collab process therefore throws in `onConnect` for every document connection, so an unauthenticated open collaboration endpoint never exists. The WebSocket upgrade handshake itself succeeds (this proves the WebSocket server is running); Phase 6 replaces the hook with real authentication.

### D39 – Tooling versions pinned beyond D11–D13

Exact pins added: ESLint 10.14.0, `@eslint/js` 10.0.1, typescript-eslint 8.72.2 (supports TypeScript `<6.1`), `@next/eslint-plugin-next` 16.4.6, eslint-plugin-react-hooks 7.1.1, globals 17.14.0, Prettier **3.9.10**, `@types/node` 24.19.2 (matches Node 24), tsx 4.23.15, pino 10.4.0, pino-pretty 13.2.0, ioredis 5.6.1, pg 8.23.1, `@prisma/adapter-pg` 7.10.1, yjs 13.6.33, y-protocols 1.0.7, `@tailwindcss/postcss` 4.3.5, zod 4.6.7. Prettier 3.10.0 (released 2026-11-11) was rejected by pnpm 12's release-age supply-chain gate; 3.9.10 (2026-10-10) is used instead rather than excluding the package from the gate. pnpm 12 requires explicit build-script approval: `allowBuilds` in `pnpm-workspace.yaml` allows only `@prisma/engines`, `prisma` and `esbuild`. TypeScript stays 5.9.3 (U2).

### D40 – Environment validation scope and rules

Zod schemas live in `@conote/shared` (`apiEnvSchema`, `collabEnvSchema`, `webEnvSchema`, `dbEnvSchema`); `parseEnv(scope, schema, source)` is pure. Each process validates at startup and exits non-zero on failure. Error messages list variable names and reasons only, never values. Only variables used by the current phase are validated; later phases add theirs with their code. `NODE_ENV` has no default and must be set. Web validates in `instrumentation.ts` at server start.

## Unresolved decisions

The "Needed by" column states the phase gate for each item. Resolved items remain listed with their evidence so permanent IDs are preserved.

| ID | Question | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **U1** *(Implemented and exercised; owner sign-off pending)* | Node.js baseline: 24 or 26? | Node 24 LTS (Maintenance from 2026-10-20, EOL 2028-04-30); Node 26 (Active LTS from 2026-10-28, EOL 2029-04-30) | Node 24 now (D16); re-evaluate Node 26 after confirming all native modules and CI images | Owner decision before Phase 1 close |
| **U2** *(Implemented and exercised; owner sign-off pending)* | TypeScript version: 5.9.3 or newer (6.x/7.x)? | Stay on 5.9.3; adopt 6.x; adopt 7.x | Stay on 5.9.3 (D17); trial newer in a separate branch once the toolchain is verified | Owner decision before Phase 1 close |
| **U3** | Do the Hocuspocus store hooks and Redis extension behave as the persistence design (D15) assumes? (debounce option names, store-on-unload, behaviour of change/store hooks for updates that arrive via Redis, duplicate writes, lock behaviour) | Diff-on-store (baseline); per-update append from change hook with origin filtering | Diff-on-store; spike decides | Phase 1 spike |
| **U4** | Awareness semantics: do awareness updates propagate across instances and from read-only connections (viewers/commenters), and what happens to stale awareness states after an instance crash? | n/a (empirical) | Verify in spike; if read-only connections cannot publish awareness, decide whether viewers appear in presence | Phase 1 spike |

| **U6** | Invitation email delivery provider | SMTP via Mailpit in dev + provider TBD in prod; transactional email API | Phase 3 ships **link-based** invitations plus an email-adapter interface (console/Mailpit for dev); pick a production provider before Phase 11 | Phase 3 (link only) / Phase 11 (provider) |
| **U7** | Image upload flow and limits | Presigned direct upload to object storage; upload through the API | Presigned upload with server-side validation of type and size limits; exact limits to be set in Phase 4. Also confirm MinIO's current distribution/licensing for local dev | Phase 4 |
| **U8** | Behaviour of comment anchors after version restore (D8 + D9) | Mark affected threads "detached" (kept, unanchored); attempt re-anchoring by quoted text | Mark detached, keep thread and quoted text; re-anchoring is a later enhancement | Phase 8 |
| **U9** | External guests (access to a single page for non-members) | Out of scope for MVP; or add later | Out of scope; revisit after Phase 10 | Phase 3 (confirm out of scope) |
| **U10** | Production hosting target | Single VM with Docker Compose; managed container platform + managed Postgres/Redis | DEPLOYMENT.md is written provider-neutral (container images + reference topology); owner picks a target before Phase 11 | Phase 11 |
| **U11** | Retention policy for AUTO snapshots and activity logs | Keep all; prune AUTO snapshots by age/count while always keeping MANUAL and PRE_RESTORE; time-based activity pruning | Keep MANUAL and PRE_RESTORE indefinitely, prune AUTO snapshots by a policy chosen from Phase 9 growth measurements; activity logs kept until Phase 10 review | Phase 8 (snapshot rules) / Phase 10 (implementation) |
| **U12** | Repository license and visibility (public/private) | Permissive open-source license; all rights reserved/private | Owner decides; until decided the repository states "License: not yet chosen" | Before the repository is made public (no later than Phase 11) |
| **U13** | Which explicit Phase 9 recovery mechanism detects and reconciles documents after Redis Pub/Sub message loss? Options: force clients to reconnect to PostgreSQL-hydrated state, or implement verified server-to-server reconciliation. Redis reconnect alone is insufficient. | Select from Phase 1/9 evidence; forced reconnect is the conservative baseline | Phase 9 |

---

## Resolved questions

| ID | Question | Resolution and evidence |
|---|---|---|
| **U5 – RESOLVED (Phase 1a, 2026-11-12)** | Prisma 7 setup in a pnpm monorepo: generator output, driver adapter, `prisma.config.ts` and migration workflow | Prisma 7.10.1 configured with `prisma-client` output under `packages/db/src/generated/prisma`, `@prisma/adapter-pg`, and `prisma.config.ts`. Owner reports successful client generation, a real adapter query, `pnpm db:migrate:deploy`, and `pnpm db:migrate:status` reporting up to date. See D35/D36 and HANDOVER §3. |

## Superseded decisions

None.

## References

Retrieved during Phase 0 research (official or primary sources):

- Hocuspocus Redis extension – https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- Hocuspocus hooks – https://tiptap.dev/docs/hocuspocus/server/hooks
- Hocuspocus authentication guide – https://tiptap.dev/docs/hocuspocus/guides/authentication
- Hocuspocus collaborative editing guide – https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing
- Tiptap Collaboration extension – https://tiptap.dev/docs/editor/api/extensions/collaboration
- `y-websocket` – https://github.com/yjs/y-websocket
- `y-redis` – https://github.com/yjs/y-redis
- Prisma system requirements – https://www.prisma.io/docs/orm/reference/system-requirements
- Prisma supported databases – https://www.prisma.io/docs/orm/reference/supported-databases
- Node.js lifecycle (third-party aggregation of the official schedule) – https://endoflife.date/nodejs

Not fetched during Phase 0 (official documentation locations; confirm when implementing):

- Yjs documentation – https://docs.yjs.dev (relative positions, document updates, awareness)
- Node.js release schedule – https://nodejs.org/en/about/previous-releases
- Next.js rewrites – https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
- OWASP Password Storage – https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management – https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention – https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Fastify – https://fastify.dev/docs/latest/ ; Zod – https://zod.dev ; `jose` – https://github.com/panva/jose
