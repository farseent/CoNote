# CoNote – Phase 0 Documentation Corrections

These are documentation-only corrections. No application code was implemented and no tests or infrastructure experiments were run.

## Five corrections

1. **Redis outage and reconvergence**
   - Removed the unsupported claim that Redis reconnect automatically reconverges open Hocuspocus documents.
   - Documented Pub/Sub message loss, stale-document detection and explicit resynchronization.
   - Added unresolved item U13 for selecting and verifying the Phase 9 recovery mechanism.

2. **Exactly one workspace owner**
   - Clarified that the partial unique index enforces at most one owner only.
   - Required a deferred PostgreSQL constraint trigger to enforce at least one owner at transaction commit.
   - Documented atomic workspace creation and ownership transfer, with rollback tests.

3. **Readiness and degraded operation**
   - Separated liveness, API readiness, PostgreSQL health and Redis health.
   - Redis outage alone no longer makes the API globally unready.
   - Defined scoped degraded/fail-closed behaviour for Redis-dependent and security-sensitive operations.

4. **Concurrent page-tree mutations**
   - Required a workspace-scoped transaction advisory lock for all structural page-tree mutations.
   - Required a composite `(workspaceId, parentId)` foreign key to prevent cross-workspace parent links.
   - Added race tests for cycles, concurrent moves and depth limits.

5. **Version restore during active editing**
   - Required a durable per-page restore barrier across collab instances.
   - Drain and commit updates accepted before the barrier, then commit PRE_RESTORE before applying the restore.
   - Require safe abort/rollback on failure and client resynchronization after release.

## Files updated

- ARCHITECTURE.md
- DATABASE_SCHEMA.md
- IMPLEMENTATION_PLAN.md
- DECISIONS.md
- API_CONTRACTS.md
- WEBSOCKET_PROTOCOL.md
- TESTING.md
- DEPLOYMENT.md
- HANDOVER.md
- CLAUDE.md
- PROJECT_MASTER.md
- README.md

## Important status

The documents remain in Phase 0 and await owner review. The corrections are design requirements, not verified implementation results. Phase 1 must not start until the owner approves Phase 0. Phase 9 must verify the Redis recovery mechanism; Phase 8 must verify the restore barrier.
