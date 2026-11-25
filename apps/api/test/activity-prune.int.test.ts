import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, deleteTestUsers, type Harness } from './auth-harness.js';
import { pruneActivityLogs } from '../src/jobs/activity-prune.js';
import { newUser, newWorkspace } from './workspace-harness.js';

let h: Harness;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

async function seed(workspaceId: string, ageDays: number, count: number): Promise<string[]> {
  const createdAt = new Date(h.clock.now.getTime() - ageDays * DAY);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = await h.deps.prisma.activityLog.create({
      data: { workspaceId, action: 'page.edited', createdAt },
    });
    ids.push(row.id);
  }
  return ids;
}

describe('activity-log retention (AC-10.6, U11)', () => {
  it('deletes rows older than the retention period and keeps newer ones', async () => {
    const owner = await newUser(h, 'retention');
    const workspaceId = await newWorkspace(h, owner);
    const old = await seed(workspaceId, 400, 3);
    const edge = await seed(workspaceId, 364, 2);
    const recent = await seed(workspaceId, 1, 2);
    const deleted = await pruneActivityLogs(h.deps.prisma, h.clock.now, 365);
    expect(deleted).toBeGreaterThanOrEqual(3);
    const left = await h.deps.prisma.activityLog.findMany({
      where: { id: { in: [...old, ...edge, ...recent] } },
      select: { id: true },
    });
    expect(left.map((r) => r.id).sort()).toEqual([...edge, ...recent].sort());
  });

  it('works through a backlog larger than one batch and is safe to run twice', async () => {
    const owner = await newUser(h, 'backlog');
    const workspaceId = await newWorkspace(h, owner);
    const old = await seed(workspaceId, 500, 7);
    const first = await pruneActivityLogs(h.deps.prisma, h.clock.now, 365, 3);
    expect(first).toBeGreaterThanOrEqual(7);
    const again = await pruneActivityLogs(h.deps.prisma, h.clock.now, 365, 3);
    expect(again).toBe(0);
    expect(await h.deps.prisma.activityLog.count({ where: { id: { in: old } } })).toBe(0);
  });

  it('two prunes at once never fail and leave nothing old behind', async () => {
    const owner = await newUser(h, 'concurrent');
    const workspaceId = await newWorkspace(h, owner);
    const old = await seed(workspaceId, 700, 12);
    const results = await Promise.all([
      pruneActivityLogs(h.deps.prisma, h.clock.now, 365, 4),
      pruneActivityLogs(h.deps.prisma, h.clock.now, 365, 4),
    ]);
    expect(results[0]! + results[1]!).toBeGreaterThanOrEqual(12);
    expect(await h.deps.prisma.activityLog.count({ where: { id: { in: old } } })).toBe(0);
  });

  it('does not touch other tables or the workspace itself', async () => {
    const owner = await newUser(h, 'scope');
    const workspaceId = await newWorkspace(h, owner);
    await seed(workspaceId, 900, 1);
    await pruneActivityLogs(h.deps.prisma, h.clock.now, 365);
    expect(await h.deps.prisma.workspace.count({ where: { id: workspaceId } })).toBe(1);
    expect(await h.deps.prisma.workspaceMember.count({ where: { workspaceId } })).toBe(1);
  });
});
