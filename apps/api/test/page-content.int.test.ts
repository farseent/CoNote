import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, emptyEditorDocument } from '@conote/shared';
import { createHarness, deleteTestUsers, uniqueEmail, type Harness } from './auth-harness.js';
import { purgeExpiredPages } from '../src/jobs/page-purge.js';
import { addMember, errorCode, newPage, newUser, newWorkspace } from './workspace-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const url = (pageId: string) => `/api/v1/pages/${pageId}/content`;

async function setup() {
  const owner = await newUser(h, 'owner');
  const ws = await newWorkspace(h, owner);
  const page = await newPage(h, owner, ws);
  return { owner, ws, page };
}
const save = (
  token: string,
  pageId: string,
  baseRevision: number,
  content: unknown = doc(p('hi')),
) => h.call('PUT', url(pageId), { token, body: { baseRevision, content } });

describe('CONTENT-01 reading', () => {
  it('returns an empty state for a page that was never edited', async () => {
    const { owner, page } = await setup();
    const res = await h.call('GET', url(page.id), { token: owner.token });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      content: null,
      schemaVersion: 1,
      revision: 0,
      updatedAt: null,
    });
  });

  it('requires a session and never caches', async () => {
    const { owner, page } = await setup();
    expect((await h.call('GET', url(page.id))).status).toBe(401);
    expect(
      (await h.call('GET', url(page.id), { token: owner.token })).headers['cache-control'],
    ).toBe('no-store');
  });

  it('rejects malformed page ids', async () => {
    const { owner } = await setup();
    expect((await h.call('GET', url('nope'), { token: owner.token })).status).toBe(400);
  });
});

describe('CONTENT-02 saving and loading', () => {
  it('saves, then loads exactly what was saved (round trip)', async () => {
    const { owner, page } = await setup();
    const content = doc(
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'Title' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('done')] }],
      },
    );
    const saved = await save(owner.token, page.id, 0, content);
    expect(saved.status).toBe(200);
    expect(saved.body.data.revision).toBe(1);
    const loaded = await h.call('GET', url(page.id), { token: owner.token });
    expect(loaded.body.data).toMatchObject({ content, revision: 1, schemaVersion: 1 });
    expect(loaded.body.data.updatedAt).toBe(saved.body.data.updatedAt);
  });

  it('increments the revision on every save and touches the page', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0);
    h.clock.advance(60_000);
    const second = await save(owner.token, page.id, 1, doc(p('two')));
    expect(second.body.data.revision).toBe(2);
    const row = await h.deps.prisma.page.findUnique({ where: { id: page.id } });
    expect(row?.updatedAt.toISOString()).toBe(second.body.data.updatedAt);
    const stored = await h.deps.prisma.pageContent.findUnique({ where: { pageId: page.id } });
    expect(stored?.updatedById).toBe(owner.id);
  });

  it('answers 409 to a save based on an old revision and keeps the newer content', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0, doc(p('first')));
    await save(owner.token, page.id, 1, doc(p('second')));
    const stale = await save(owner.token, page.id, 1, doc(p('stale tab')));
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('CONFLICT');
    const again = await save(owner.token, page.id, 0, doc(p('thinks it is new')));
    expect(again.status).toBe(409);
    const loaded = await h.call('GET', url(page.id), { token: owner.token });
    expect(loaded.body.data.content).toEqual(doc(p('second')));
  });

  it('lets exactly one of two simultaneous saves win', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0);
    const results = await Promise.all([
      save(owner.token, page.id, 1, doc(p('A'))),
      save(owner.token, page.id, 1, doc(p('B'))),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const first = await Promise.all([
      save(owner.token, (await newPage(h, owner, page.workspaceId)).id, 0),
      save(owner.token, page.id, 5),
    ]);
    expect(first[1].status).toBe(409);
  });

  it('lets exactly one of two simultaneous first saves win', async () => {
    const { owner, page } = await setup();
    const results = await Promise.all([
      save(owner.token, page.id, 0, doc(p('A'))),
      save(owner.token, page.id, 0, doc(p('B'))),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('accepts the empty document', async () => {
    const { owner, page } = await setup();
    expect((await save(owner.token, page.id, 0, emptyEditorDocument())).status).toBe(200);
  });
});

describe('CONTENT validation (persisted content is checked)', () => {
  const bad: [string, unknown][] = [
    ['unknown node type', doc({ type: 'script', content: [] })],
    ['heading level out of range', doc({ type: 'heading', attrs: { level: 6 }, content: [] })],
    [
      'javascript: link',
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      }),
    ],
    ['external image', doc({ type: 'image', attrs: { src: 'https://example.com/x.png' } })],
    ['unknown attribute', doc({ type: 'paragraph', attrs: { onclick: 'x' } })],
    ['invalid structure', doc({ type: 'bulletList' })],
    ['not a document', { type: 'paragraph' }],
    ['empty document', doc()],
  ];

  it.each(bad)('rejects %s with 400 and a field path', async (_name, content) => {
    const { owner, page } = await setup();
    const res = await save(owner.token, page.id, 0, content);
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toMatch(/^content/);
    expect(await h.deps.prisma.pageContent.count({ where: { pageId: page.id } })).toBe(0);
  });

  it('rejects unknown body fields and bad revisions', async () => {
    const { owner, page } = await setup();
    for (const body of [
      { baseRevision: 0, content: doc(p('x')), extra: 1 },
      { baseRevision: -1, content: doc(p('x')) },
      { content: doc(p('x')) },
      { baseRevision: 0 },
    ]) {
      expect((await h.call('PUT', url(page.id), { token: owner.token, body })).status).toBe(400);
    }
  });

  it('rejects documents over the size limit (400) and bodies over the request limit (413)', async () => {
    const { owner, page } = await setup();
    const justOver = await save(owner.token, page.id, 0, doc(p('x'.repeat(MAX_DOCUMENT_BYTES))));
    expect(justOver.status).toBe(400);
    const huge = await save(
      owner.token,
      page.id,
      0,
      doc(p('x'.repeat(MAX_DOCUMENT_BYTES + 10_000))),
    );
    expect(huge.status).toBe(413);
    expect(errorCode(huge)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('does not echo submitted text in error responses', async () => {
    const { owner, page } = await setup();
    const res = await save(
      owner.token,
      page.id,
      0,
      doc({
        type: 'heading',
        attrs: { level: 9 },
        content: [{ type: 'text', text: 'TOP-SECRET-TEXT' }],
      }),
    );
    expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET-TEXT');
  });

  it('refuses to serve stored content that no longer satisfies the format', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0);
    await h.deps.prisma.pageContent.update({
      where: { pageId: page.id },
      data: { content: { type: 'doc', content: [{ type: 'script' }] } },
    });
    const res = await h.call('GET', url(page.id), { token: owner.token });
    expect(res.status).toBe(500);
    expect(errorCode(res)).toBe('INTERNAL_ERROR');
  });
});

describe('CONTENT authorization (viewers cannot edit)', () => {
  it('lets viewers and commenters read but not save', async () => {
    const { owner, ws, page } = await setup();
    await save(owner.token, page.id, 0, doc(p('secret plan')));
    for (const role of ['VIEWER', 'COMMENTER'] as const) {
      const member = await addMember(h, ws, owner, role);
      expect((await h.call('GET', url(page.id), { token: member.token })).status).toBe(200);
      const denied = await save(member.token, page.id, 1);
      expect(denied.status).toBe(403);
      expect(errorCode(denied)).toBe('FORBIDDEN');
    }
    const loaded = await h.call('GET', url(page.id), { token: owner.token });
    expect(loaded.body.data.revision).toBe(1);
  });

  it('lets editors and admins save', async () => {
    const { owner, ws, page } = await setup();
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const admin = await addMember(h, ws, owner, 'ADMIN');
    expect((await save(editor.token, page.id, 0)).status).toBe(200);
    expect((await save(admin.token, page.id, 1)).status).toBe(200);
  });

  it('hides pages from non-members (404 for read and write)', async () => {
    const { page } = await setup();
    const stranger = await newUser(h, 'stranger');
    expect((await h.call('GET', url(page.id), { token: stranger.token })).status).toBe(404);
    expect((await save(stranger.token, page.id, 0)).status).toBe(404);
  });

  it('follows page permission overrides', async () => {
    const { owner, ws, page } = await setup();
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const set = (userId: string, role: string) =>
      h.call('PUT', `/api/v1/pages/${page.id}/permissions/${userId}`, {
        token: owner.token,
        body: { role },
      });
    await set(viewer.id, 'EDITOR');
    expect((await save(viewer.token, page.id, 0)).status).toBe(200);
    await set(editor.id, 'VIEWER');
    expect((await save(editor.token, page.id, 1)).status).toBe(403);
    await set(editor.id, 'NONE');
    expect((await h.call('GET', url(page.id), { token: editor.token })).status).toBe(404);
  });

  it('answers 404 for a page in the trash, and its content survives a restore', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0, doc(p('keep me')));
    await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: owner.token });
    expect((await h.call('GET', url(page.id), { token: owner.token })).status).toBe(404);
    expect((await save(owner.token, page.id, 1)).status).toBe(404);
    await h.call('POST', `/api/v1/pages/${page.id}/restore`, { token: owner.token });
    expect((await h.call('GET', url(page.id), { token: owner.token })).body.data.content).toEqual(
      doc(p('keep me')),
    );
  });

  it('is removed with the page when it is purged', async () => {
    const { owner, page } = await setup();
    await save(owner.token, page.id, 0);
    await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: owner.token });
    h.clock.advance(31 * 24 * 60 * 60 * 1000);
    await purgeExpiredPages(h.deps.prisma, h.clock.now);
    expect(await h.deps.prisma.pageContent.count({ where: { pageId: page.id } })).toBe(0);
  });
});

describe('CONTENT request protections', () => {
  it('applies the Origin and content-type checks to saves', async () => {
    const { owner, page } = await setup();
    const body = { baseRevision: 0, content: doc(p('x')) };
    expect(
      (
        await h.call('PUT', url(page.id), {
          token: owner.token,
          body,
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.call('PUT', url(page.id), { token: owner.token, body, origin: null })).status,
    ).toBe(403);
    expect(
      (
        await h.call('PUT', url(page.id), {
          token: owner.token,
          body: JSON.stringify(body),
          contentType: 'text/plain',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await h.call('PUT', url(page.id), {
          token: owner.token,
          body: Buffer.from('x'),
          contentType: 'image/png',
        })
      ).status,
    ).toBe(415);
    expect((await h.call('PUT', url(page.id), { body })).status).toBe(401);
  });

  it('rate limits autosave per client address', async () => {
    const limited = await createHarness({
      config: {
        rateLimits: { ...h.config.rateLimits, contentSave: { max: 3, timeWindowMs: 60_000 } },
      },
    });
    try {
      const owner = await newUser(limited, 'owner');
      const ws = await newWorkspace(limited, owner);
      const page = await newPage(limited, owner, ws);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        statuses.push(
          (
            await limited.call('PUT', url(page.id), {
              token: owner.token,
              body: { baseRevision: i, content: doc(p('x')) },
            })
          ).status,
        );
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      await deleteTestUsers(limited.deps);
      await limited.close();
    }
  });

  it('keeps the existing page API working alongside content', async () => {
    const { owner, ws, page } = await setup();
    await save(owner.token, page.id, 0);
    expect(
      (await h.call('GET', `/api/v1/pages/${page.id}`, { token: owner.token })).body.data.page.id,
    ).toBe(page.id);
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${page.id}`, {
          token: owner.token,
          body: { title: 'Renamed' },
        })
      ).status,
    ).toBe(200);
    expect((await h.call('GET', url(page.id), { token: owner.token })).body.data.revision).toBe(1);
    void ws;
    void uniqueEmail;
  });
});
