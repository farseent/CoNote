# CoNote – REST API Contracts

**Status:** Phase 0 design. No endpoint is implemented.
**Last updated:** 2026-11-11

Decision IDs (`D#`, `U#`) are in [DECISIONS.md](DECISIONS.md). Models are in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md). Collaboration traffic (Yjs sync, awareness, application events, version create/restore) is **not** REST; see [WEBSOCKET_PROTOCOL.md](WEBSOCKET_PROTOCOL.md).

Endpoint IDs (e.g. `AUTH-02`) are permanent and used by TESTING.md and IMPLEMENTATION_PLAN.md.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` (D31). Browsers call it on the web origin, which proxies to the API (D6). The API is not publicly reachable. |
| Format | JSON (`Content-Type: application/json`), UTF-8. Exception: `VER-03` returns binary. |
| Identifiers | UUIDs (D29). |
| Timestamps | ISO 8601 UTC strings. |
| Authentication | Session cookie (D5). "Auth: Session" below means a valid, unexpired, unrevoked session; otherwise `401 UNAUTHENTICATED`. |
| CSRF | For `POST`, `PUT`, `PATCH`, `DELETE`: `Content-Type: application/json` required (else `415`) and `Origin` must be on the allow-list (else `403 INVALID_ORIGIN`). |
| Validation | Zod schemas from `packages/shared`; unknown fields are rejected; failures return `400 VALIDATION_ERROR`. |
| Rate limiting | Redis-backed; if Redis is unavailable, security-sensitive limits fail closed with scoped `503 SERVICE_UNAVAILABLE` unless a documented, bounded per-process fallback is explicitly approved for that limiter. Never silently disable authentication or abuse limits. Stricter on `AUTH-01`, `AUTH-02`, `AUTH-07`, `INV-05`, `INV-06`, `PAGE-10`, `ASSET-01`. Exceeding returns `429 RATE_LIMITED` with the standard retry headers emitted by the rate-limit plugin (confirmed in Phase 2). Limit values are chosen in Phase 2/10 and recorded, not guessed here. |
| Existence hiding | If the actor has no access at all to a workspace/page/thread, the API returns `404 NOT_FOUND`, not `403`. `403 FORBIDDEN` is used when the actor can see the resource but lacks the required role. |
| Pagination | Cursor-based: `?limit=<1..100>&cursor=<opaque>`; default limit 50. Response `meta: { "nextCursor": string | null }`. |
| No-content results | Operations with no payload return `200` with `data: null`. |

### Role notation

Workspace roles are ordered `VIEWER < COMMENTER < EDITOR < ADMIN < OWNER`. **`WS≥X`** means the actor's workspace role is at least `X`. The **effective page role** (D23) is ordered `NONE < VIEWER < COMMENTER < EDITOR < ADMIN < OWNER`; **`PAGE≥X`** means the actor's effective role on that page is at least `X`. `NONE` or no workspace membership means no access.

### Response envelope (D31)

Success:

```json
{ "success": true, "data": { }, "meta": { } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": [ { "path": "email", "message": "Invalid email" } ],
    "requestId": "uuid"
  }
}
```

`details` is optional. `requestId` is also returned in the `X-Request-Id` response header and written to logs.

### Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or path failed validation |
| 400 | `INVITATION_INVALID` | Token unknown, expired, revoked, used, or email mismatch (deliberately indistinguishable) |
| 401 | `UNAUTHENTICATED` | Missing/invalid/expired session |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (uniform message) |
| 403 | `FORBIDDEN` | Insufficient role |
| 403 | `INVALID_ORIGIN` | Origin not allowed on a state-changing request |
| 404 | `NOT_FOUND` | Resource missing or hidden |
| 409 | `CONFLICT` | Generic state conflict |
| 409 | `EMAIL_TAKEN` | Email already registered |
| 409 | `ALREADY_MEMBER` | Invitee is already a workspace member |
| 409 | `INVITATION_EXISTS` | A pending invitation for that email exists |
| 409 | `INVALID_MOVE` | Move would create a cycle, cross workspaces, or exceed the depth limit |
| 409 | `CANNOT_RESTRICT_ADMIN` | Page override targets an Admin/Owner |
| 409 | `OWNER_PROTECTED` | Operation would remove or demote the Owner |
| 413 | `PAYLOAD_TOO_LARGE` | Body or declared upload size over the limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Wrong content type |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected error (no internal details leaked) |
| 503 | `SERVICE_UNAVAILABLE` | A dependency (database, Redis, storage) is unavailable |

## 2. Resource shapes

```text
UserSummary   { id, displayName, presenceColor, avatarUrl | null }
User          { id, email, displayName, presenceColor, avatarUrl | null, createdAt }
SessionInfo   { id, createdAt, lastSeenAt, expiresAt, userAgent | null, current: boolean }
Workspace     { id, name, myRole, createdAt, updatedAt }
Member        { user: UserSummary, email?: string /* only for ADMIN+ viewers */, role, joinedAt }
Invitation    { id, email, role, status: "PENDING"|"ACCEPTED"|"REVOKED"|"EXPIRED", expiresAt, createdAt, invitedBy: UserSummary | null }
Page          { id, workspaceId, parentId | null, title, icon | null, position, myRole, createdAt, updatedAt, deletedAt | null }
PagePermission{ user: UserSummary, role: "NONE"|"VIEWER"|"COMMENTER"|"EDITOR", createdAt }
Asset         { id, status: "PENDING"|"READY", contentType, sizeBytes, url /* "/api/v1/assets/{id}" */ }
Thread        { id, pageId, quotedText, anchor: { start: base64, end: base64 }, anchorStatus: "ACTIVE"|"DETACHED",
                resolved: boolean, resolvedAt | null, resolvedBy: UserSummary | null, createdBy: UserSummary | null,
                createdAt, comments: Comment[] }
Comment       { id, threadId, author: UserSummary | null, body, createdAt, deleted: boolean /* body is "" when true */ }
VersionMeta   { id, pageId, kind: "AUTO"|"MANUAL"|"PRE_RESTORE", label | null, sizeBytes, createdBy: UserSummary | null,
                contributors: UserSummary[], createdAt }
Activity      { id, workspaceId, pageId | null, actor: UserSummary | null, action, metadata | null, createdAt }
```

`myRole` is `WorkspaceRole` for `Workspace` and the effective page role for `Page`. `avatarUrl` and image URLs use the stable form `/api/v1/assets/{assetId}` (see `ASSET-03`).

## 3. Authentication (`AUTH`)

### AUTH-01 `POST /api/v1/auth/register`
- **Auth:** none. **Authz:** none. **Rate limited (strict).**
- **Request:** `{ "email": string, "password": string, "displayName": string }`
- **Validation:** email valid, ≤ 254 chars, normalized to lowercase; password 12–128 chars (initial policy); displayName 1–80 trimmed.
- **Response `201`:** `{ "user": User }` and `Set-Cookie` (session). The user is logged in.
- **Errors:** `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`, `429`. Note: `EMAIL_TAKEN` reveals that an email is registered; this is accepted for the MVP and mitigated by rate limiting.

### AUTH-02 `POST /api/v1/auth/login`
- **Auth:** none. **Rate limited (strict).**
- **Request:** `{ "email": string, "password": string }`
- **Response `200`:** `{ "user": User }` and `Set-Cookie`. Creates a new session; updates `lastLoginAt`.
- **Errors:** `400`, `401 INVALID_CREDENTIALS` (identical for unknown email and wrong password; comparable work is performed in both cases), `429`.

### AUTH-03 `POST /api/v1/auth/logout`
- **Auth:** Session. **Request:** none (`{}`).
- **Response `200`:** `data: null`; revokes the current session and clears the cookie.
- **Side effect:** publishes a `session.revoked` access event (D22).

### AUTH-04 `GET /api/v1/auth/session`
- **Auth:** Session.
- **Response `200`:** `{ "user": User, "session": SessionInfo }`.
- **Errors:** `401`.

### AUTH-05 `GET /api/v1/auth/sessions`
- **Auth:** Session. **Response `200`:** `{ "sessions": SessionInfo[] }` (own, non-revoked, non-expired).

### AUTH-06 `DELETE /api/v1/auth/sessions/:sessionId`
- **Auth:** Session. **Authz:** the session must belong to the actor.
- **Response `200`:** `data: null`. Publishes `session.revoked`.
- **Errors:** `404 NOT_FOUND` (also when it belongs to someone else).

### AUTH-07 `POST /api/v1/auth/password`
- **Auth:** Session. **Rate limited (strict).**
- **Request:** `{ "currentPassword": string, "newPassword": string }` (new: 12–128 chars).
- **Response `200`:** `data: null`. Updates the hash and `passwordChangedAt`, **revokes all other sessions**, publishes `session.revoked` for each.
- **Errors:** `400`, `401 INVALID_CREDENTIALS` (wrong current password), `429`.

## 4. Users (`USER`)

### USER-01 `GET /api/v1/users/me`
- **Auth:** Session. **Response `200`:** `{ "user": User }`.

### USER-02 `PATCH /api/v1/users/me`
- **Auth:** Session.
- **Request (all optional, at least one):** `{ "displayName"?: string, "presenceColor"?: "#RRGGBB", "avatarAssetId"?: uuid | null }`
- **Validation:** as in DATABASE_SCHEMA §10; `avatarAssetId` must be a `READY` `AVATAR` asset uploaded by the actor.
- **Response `200`:** `{ "user": User }`. **Errors:** `400`, `404` (asset).

## 5. Workspaces (`WS`)

### WS-01 `POST /api/v1/workspaces`
- **Auth:** Session. **Request:** `{ "name": string }` (1–100).
- **Response `201`:** `{ "workspace": Workspace }` with `myRole: "OWNER"`. The creator becomes `OWNER`. Logs `workspace.created`.

### WS-02 `GET /api/v1/workspaces`
- **Auth:** Session. **Response `200`:** `{ "workspaces": Workspace[] }` (workspaces the actor belongs to).

### WS-03 `GET /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `WS≥VIEWER`. **Response `200`:** `{ "workspace": Workspace }`. **Errors:** `404`.

### WS-04 `PATCH /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "name": string }`.
- **Response `200`:** `{ "workspace": Workspace }`. Logs `workspace.updated`. **Errors:** `400`, `403`, `404`.

### WS-05 `DELETE /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `OWNER`. **Request:** `{ "confirmName": string }` (must equal the workspace name).
- **Response `200`:** `data: null`. Cascades (DATABASE_SCHEMA §8); publishes access events so open collaboration connections close.
- **Errors:** `400` (confirmation mismatch), `403`, `404`.

### WS-06 `GET /api/v1/workspaces/:workspaceId/members`
- **Auth:** Session. **Authz:** `WS≥VIEWER`. **Response `200`:** `{ "members": Member[] }` (`email` included only for `WS≥ADMIN`).

### WS-07 `PATCH /api/v1/workspaces/:workspaceId/members/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "role": "ADMIN"|"EDITOR"|"COMMENTER"|"VIEWER" }`.
- **Rules:** `OWNER` cannot be assigned here (use `WS-09`); the Owner's role cannot be changed (`409 OWNER_PROTECTED`); **only the Owner may grant or revoke `ADMIN`** (an Admin may manage `EDITOR`/`COMMENTER`/`VIEWER` members only; otherwise `403`).
- **Response `200`:** `{ "member": Member }`. Logs `member.role_changed`; publishes `member.role_changed` access event.
- **Errors:** `400`, `403`, `404`, `409`.

### WS-08 `DELETE /api/v1/workspaces/:workspaceId/members/:userId`
- **Auth:** Session. **Authz:** the actor removing **themselves** (leave; allowed for any non-owner), or `WS≥ADMIN` removing another member (Admins may remove only non-Admin members; the Owner may remove Admins).
- **Rules:** the Owner can neither be removed nor leave (`409 OWNER_PROTECTED`; transfer ownership first). The member's page overrides in the workspace are deleted in the same transaction.
- **Response `200`:** `data: null`. Logs `member.removed` or `member.left`; publishes `member.removed` access event.
- **Errors:** `403`, `404`, `409`.

### WS-09 `POST /api/v1/workspaces/:workspaceId/transfer-ownership`
- **Auth:** Session. **Authz:** `OWNER`. **Request:** `{ "userId": uuid, "password": string }` (the actor re-enters their password).
- **Rules:** target must be an existing member. In one transaction the target becomes `OWNER` and the actor becomes `ADMIN`.
- **Response `200`:** `{ "workspace": Workspace }`. Logs `ownership.transferred`; publishes access events.
- **Errors:** `400`, `401 INVALID_CREDENTIALS`, `403`, `404`.

## 6. Invitations (`INV`)

Invitation links have the form `<APP_URL>/invite#token=<token>`; the token is in the **URL fragment** so it is not sent to servers or written to access logs, and the web app posts it in a request body (D30). The raw token is returned **once** (`INV-01`, `INV-04`) and only its hash is stored. Email delivery is optional and provider-dependent (U6); the MVP guarantees link-based invitations.

### INV-01 `POST /api/v1/workspaces/:workspaceId/invitations`
- **Auth:** Session. **Authz:** `WS≥ADMIN`; only the Owner may invite with role `ADMIN`.
- **Request:** `{ "email": string, "role": "ADMIN"|"EDITOR"|"COMMENTER"|"VIEWER" }`
- **Response `201`:** `{ "invitation": Invitation, "inviteUrl": string }`. Expires in 7 days (D30). Logs `member.invited`.
- **Errors:** `400`, `403`, `404`, `409 ALREADY_MEMBER`, `409 INVITATION_EXISTS`.

### INV-02 `GET /api/v1/workspaces/:workspaceId/invitations`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Query:** `status?` (`PENDING|ACCEPTED|REVOKED|EXPIRED`), pagination.
- **Response `200`:** `{ "invitations": Invitation[] }` (never includes tokens).

### INV-03 `DELETE /api/v1/workspaces/:workspaceId/invitations/:invitationId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Revokes a `PENDING` invitation. Logs `invitation.revoked`.
- **Response `200`:** `data: null`. **Errors:** `404`, `409 CONFLICT` (not pending).

### INV-04 `POST /api/v1/workspaces/:workspaceId/invitations/:invitationId/resend`
- **Auth:** Session. **Authz:** as `INV-01`. Rotates the token (old link stops working), extends expiry, re-sends email if an adapter is configured.
- **Response `200`:** `{ "invitation": Invitation, "inviteUrl": string }`. **Errors:** `404`, `409` (not pending).

### INV-05 `POST /api/v1/invitations/preview`
- **Auth:** none. **Rate limited (strict).** **Request:** `{ "token": string }`.
- **Response `200`:** `{ "workspaceName": string, "role": string, "invitedBy": string | null, "emailHint": "j***@example.com" }`.
- **Errors:** `400 INVITATION_INVALID`, `429`.

### INV-06 `POST /api/v1/invitations/accept`
- **Auth:** Session. **Rate limited (strict).** **Request:** `{ "token": string }`.
- **Rules:** token valid and unexpired; the actor's email equals the invitation email; the invitation becomes `ACCEPTED` and a `WorkspaceMember` is created in one transaction (single use).
- **Response `200`:** `{ "workspace": Workspace }`. Logs `member.joined`.
- **Errors:** `400 INVITATION_INVALID`, `401`, `429`.

## 7. Pages (`PAGE`)

### PAGE-01 `POST /api/v1/workspaces/:workspaceId/pages`
- **Auth:** Session. **Authz:** root page: `WS≥EDITOR`; child page: `PAGE≥EDITOR` on the parent.
- **Request:** `{ "title"?: string (≤200), "icon"?: string (≤32), "parentId"?: uuid | null, "afterPageId"?: uuid | null }` (`afterPageId` places the page after that sibling; omitted = last).
- **Response `201`:** `{ "page": Page }`. Logs `page.created`.
- **Errors:** `400`, `403`, `404`, `409 INVALID_MOVE` (depth limit or parent in another workspace).

### PAGE-02 `GET /api/v1/workspaces/:workspaceId/pages`
- **Auth:** Session. **Authz:** `WS≥VIEWER`.
- **Response `200`:** `{ "pages": Page[] }` — a flat list of non-deleted pages with effective role ≥ `VIEWER`, ordered by `(parentId, position)`; the client builds the tree. Pages whose ancestors are inaccessible appear as roots in the client's view. Unpaginated in the MVP (revisited with Phase 9 measurements).

### PAGE-03 `GET /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`.
- **Response `200`:** `{ "page": Page, "breadcrumbs": [{ "id", "title" }] }` (only accessible ancestors).
- **Errors:** `404` (missing, deleted, or no access).

### PAGE-04 `PATCH /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR`. **Request (≥1 field):** `{ "title"?: string, "icon"?: string | null }`.
- **Response `200`:** `{ "page": Page }`. Logs `page.renamed` (title changes). **Errors:** `400`, `403`, `404`.

### PAGE-05 `POST /api/v1/pages/:pageId/move`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR` on the page and on the destination parent (root destination: `WS≥EDITOR`).
- **Request:** `{ "parentId": uuid | null, "afterPageId"?: uuid | null }`.
- **Rules:** same workspace; cannot move under itself or a descendant; depth limit 10. The service takes the workspace-tree transaction advisory lock before reading the tree and holds it through commit; all structural mutations use the same lock. A composite database FK independently rejects cross-workspace parent references. Permission overrides stay on the pages; effective access under the new parent is recomputed (access events published for affected users). Concurrent structural changes serialize; if the resulting move is invalid, return `409 INVALID_MOVE`.
- **Response `200`:** `{ "page": Page }`. Logs `page.moved`. **Errors:** `400`, `403`, `404`, `409 INVALID_MOVE`.

### PAGE-06 `DELETE /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR`.
- **Behaviour:** soft deletes the page and all descendants with one `deleteBatchId` (D24); open collaboration connections are closed via access events.
- **Response `200`:** `{ "deleteBatchId": uuid }`. Logs `page.deleted`. **Errors:** `403`, `404`.

### PAGE-07 `POST /api/v1/pages/:pageId/restore`
- **Auth:** Session. **Authz:** effective role ≥ `EDITOR` (computed ignoring the deleted flag).
- **Behaviour:** restores the page and the descendants deleted in the same batch. If the original parent is deleted or missing, the page is restored as a workspace root.
- **Response `200`:** `{ "page": Page }`. Logs `page.restored`. **Errors:** `403`, `404`, `409` (not deleted).

### PAGE-08 `GET /api/v1/workspaces/:workspaceId/trash`
- **Auth:** Session. **Authz:** `WS≥EDITOR`. **Query:** pagination.
- **Response `200`:** `{ "pages": Page[] }` — deleted batch roots the actor could edit, with `deletedAt`.

### PAGE-09 `POST /api/v1/pages/:pageId/purge`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Permanently deletes a page that is already soft-deleted (cascade). Logs `page.purged`.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`, `409` (page not deleted).

### PAGE-10 `POST /api/v1/pages/:pageId/collab-token`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Rate limited (strict).**
- **Request:** `{}`.
- **Response `200`:** `{ "token": string, "expiresAt": string, "collabUrl": string, "documentName": "page:<pageId>", "role": string, "readOnly": boolean }`.
- **Notes:** the token is an EdDSA JWT with a 60-second lifetime (D22). `role` and `readOnly` are advisory for the UI; the collab server decides from the database.
- **Errors:** `404` (also for deleted pages), `429`.

## 8. Page permissions (`PP`)

Overrides follow D23. Changes publish `page.access_changed` access events (D22).

### PP-01 `GET /api/v1/pages/:pageId/permissions`
- **Auth:** Session. **Authz:** `WS≥ADMIN`.
- **Response `200`:** `{ "overrides": PagePermission[], "inherited": [{ "user": UserSummary, "role": string, "fromPageId": uuid }] }` (overrides on ancestor pages that currently apply).

### PP-02 `PUT /api/v1/pages/:pageId/permissions/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "role": "NONE"|"VIEWER"|"COMMENTER"|"EDITOR" }`.
- **Rules:** target must be a workspace member; targets with role `ADMIN`/`OWNER` are rejected (`409 CANNOT_RESTRICT_ADMIN`).
- **Response `200`:** `{ "permission": PagePermission }` (upsert). Logs `page.permission_set`.
- **Errors:** `400`, `403`, `404`, `409`.

### PP-03 `DELETE /api/v1/pages/:pageId/permissions/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Removes the override (access falls back to inheritance). Logs `page.permission_removed`.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`.

## 9. Assets (`ASSET`)

Upload flow (design pending U7; limits and allowed types are fixed in Phase 4): authorize → upload directly to object storage with a presigned URL → confirm.

### ASSET-01 `POST /api/v1/assets/uploads`
- **Auth:** Session. **Rate limited (strict).**
- **Request:** `{ "purpose": "PAGE_IMAGE"|"AVATAR", "pageId"?: uuid /* required for PAGE_IMAGE */, "filename": string, "contentType": string, "sizeBytes": integer }`
- **Authz:** `PAGE_IMAGE`: `PAGE≥EDITOR` on the page. `AVATAR`: any authenticated user (own avatar).
- **Validation:** `contentType` in the configured allow-list of image types; `sizeBytes` within the configured limit (`413 PAYLOAD_TOO_LARGE`); storage key generated server-side (client filename is never used as the key).
- **Response `201`:** `{ "asset": Asset /* status PENDING */, "upload": { "url": string, "method": "PUT", "headers": { }, "expiresAt": string } }`.
- **Errors:** `400`, `403`, `404`, `413`, `415`, `429`.

### ASSET-02 `POST /api/v1/assets/:assetId/complete`
- **Auth:** Session. **Authz:** the uploader. The API verifies that the object exists and that its size and type match; sets status `READY`.
- **Response `200`:** `{ "asset": Asset }`. **Errors:** `404`, `409` (object missing or mismatched).

### ASSET-03 `GET /api/v1/assets/:assetId`
- **Auth:** Session. **Authz:** `PAGE_IMAGE`: `PAGE≥VIEWER` on the asset's page; `AVATAR`: any authenticated user.
- **Response `302`:** redirect to a short-lived presigned read URL. Because the stable URL is same-origin, `<img>` requests carry the session cookie. Images referenced in documents use this stable URL, never a storage URL.
- **Errors:** `401`, `404`.

## 10. Comments (`CMT`)

Creating, replying, resolving and deleting are REST operations (D8, FR-CM-06), so `PAGE≥COMMENTER` is enough and a read-only collaboration connection suffices. After each change the API publishes a `comments.changed` page event (D32).

### CMT-01 `GET /api/v1/pages/:pageId/threads`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `status?` (`open|resolved|all`, default `open`), pagination.
- **Response `200`:** `{ "threads": Thread[] }`.

### CMT-02 `POST /api/v1/pages/:pageId/threads`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`.
- **Request:** `{ "anchor": { "start": base64, "end": base64 }, "quotedText": string (≤500), "body": string (1–5000) }`
- **Validation:** anchors are valid base64 within a size limit; they are stored opaquely (the API does not interpret Yjs positions).
- **Response `201`:** `{ "thread": Thread }` (thread and first comment created in one transaction). Logs `comment.thread_created`.
- **Errors:** `400`, `403`, `404`.

### CMT-03 `POST /api/v1/threads/:threadId/comments`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER` on the thread's page. **Request:** `{ "body": string (1–5000) }`.
- **Response `201`:** `{ "comment": Comment }`. **Errors:** `400`, `403`, `404`.

### CMT-04 `POST /api/v1/threads/:threadId/resolve`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`. Sets resolved; idempotent. Logs `comment.thread_resolved`.
- **Response `200`:** `{ "thread": Thread }`. **Errors:** `403`, `404`.

### CMT-05 `POST /api/v1/threads/:threadId/reopen`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`. Clears resolved. Logs `comment.thread_reopened`.
- **Response `200`:** `{ "thread": Thread }`. **Errors:** `403`, `404`.

### CMT-06 `DELETE /api/v1/comments/:commentId`
- **Auth:** Session. **Authz:** the comment's author (with `PAGE≥COMMENTER`) or `WS≥ADMIN`. Soft delete.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`.

## 11. Version history (`VER`)

Listing and reading versions are REST. **Creating a manual snapshot and restoring a version are performed through the collaboration connection** (they must be serialized with live editing by the collab server, D9, D21); see WEBSOCKET_PROTOCOL.md ("Application messages: version.create, version.restore").

### VER-01 `GET /api/v1/pages/:pageId/versions`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `kind?` (`AUTO|MANUAL|PRE_RESTORE`), pagination.
- **Response `200`:** `{ "versions": VersionMeta[] }` newest first.

### VER-02 `GET /api/v1/pages/:pageId/versions/:versionId`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Response `200`:** `{ "version": VersionMeta }`. **Errors:** `404`.

### VER-03 `GET /api/v1/pages/:pageId/versions/:versionId/state`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`.
- **Response `200`:** binary body (`Content-Type: application/octet-stream`), the full Yjs state of the snapshot. The client loads it into a separate, non-collaborative `Y.Doc` and renders it read-only (FR-VH-04). This is the only non-JSON success response; errors still use the JSON envelope.
- **Errors:** `404`.

## 12. Activity (`ACT`)

### ACT-01 `GET /api/v1/workspaces/:workspaceId/activity`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Query:** `pageId?`, `actorId?`, `action?`, pagination.
- **Response `200`:** `{ "activity": Activity[] }` newest first.

### ACT-02 `GET /api/v1/pages/:pageId/activity`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `action?`, pagination.
- **Response `200`:** `{ "activity": Activity[] }` for that page.

## 13. Operational endpoints (`OPS`)

Not under `/api/v1`; not proxied through the web app; used by orchestration and monitoring on the internal network.

| ID | Endpoint | Behaviour |
|---|---|---|
| OPS-01 | `GET /health` | Liveness: `200` if the process is running. |
| OPS-02 | `GET /ready` | API readiness: `200` when PostgreSQL is reachable and schema-compatible; Redis health is reported separately and Redis outage alone does not make the API unready. A PostgreSQL failure or incompatible schema returns `503`. Response includes `status`, `dependencies.postgres`, and `dependencies.redis` (`healthy`/`degraded`/`unavailable`) without secrets. Collab has its own readiness endpoint: PostgreSQL is required; Redis-down is reported as degraded multi-instance capability. |

## 14. Side effects on other systems

| Trigger | Redis event published (D22, D32) |
|---|---|
| Logout, session revoke, password change | `access` channel: `session.revoked` (user id, session id) |
| Member role change / removal / leave / workspace deletion / ownership transfer | `access` channel: `member.role_changed`, `member.removed`, `workspace.deleted` |
| Page permission change, page move, page delete/restore/purge | `access` channel: `page.access_changed` (page id, affected user ids if known) |
| Comment thread or comment created/resolved/reopened/deleted | `page` channel: `comments.changed` (page id) |

Channel names and payloads are specified in WEBSOCKET_PROTOCOL.md. Events are at-most-once; the collab server's periodic revalidation and client refetch on reconnect cover missed events (D22).
