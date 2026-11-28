/**
 * Black-box production verification (docs/DEPLOYMENT.md §15, AC-11.2, AC-11.4, AC-11.5).
 *
 *   VERIFY_APP_URL=https://app.example.com pnpm verify:deployment
 *
 * It talks to a RUNNING deployment through its public addresses only, the way a browser does:
 * the web origin for REST (the web app proxies /api) and the collaboration address the API hands
 * out (PAGE-10 `collabUrl`) for the WebSocket. It creates three throw-away accounts
 * (`verify-…@verify.example`) and one workspace, and it prints every check with PASS or FAIL.
 * The exit code is 1 when any check failed. It never prints a cookie, a token or a password.
 *
 * Variables
 *   VERIFY_APP_URL          required, the public web origin (https://… in production)
 *   VERIFY_SKIP_HTTP_REDIRECT=1   skip the plain-http redirect check (a local stack without one)
 *   VERIFY_INSECURE_TLS=1   accept an untrusted certificate (LOCAL stack with a local CA only)
 *
 * Registration is rate limited per address (10 an hour, API_CONTRACTS AUTH-01): this script uses
 * three, so run it at most three times an hour from one address.
 */
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { parseRelayedAwareness } from '@conote/shared';

if (process.env['VERIFY_INSECURE_TLS'] === '1') process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const appUrl = (process.env['VERIFY_APP_URL'] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(appUrl)) {
  console.error('Set VERIFY_APP_URL to the web origin, for example https://app.example.com');
  process.exit(2);
}
const APP_ORIGIN = new URL(appUrl).origin;
const PASSWORD = 'verify-deployment-passphrase-1';
const PREFIX = 'conote-verify';

// ───────────── result bookkeeping ─────────────

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];
async function check(name: string, run: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = (await run()) ?? '';
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}  (${detail})`);
    return false;
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await sleep(50);
  }
}

// ───────────── a tiny REST client with a cookie jar (values are never printed) ─────────────

interface Reply {
  status: number;
  headers: Headers;
  body: { data?: Record<string, unknown>; error?: { code?: string } } | null;
}

class Account {
  cookie = '';
  rawSetCookie = '';
  userId = '';
  constructor(
    readonly label: string,
    readonly email: string,
  ) {}

  async call(
    method: string,
    path: string,
    body?: unknown,
    origin: string = APP_ORIGIN,
  ): Promise<Reply> {
    const headers: Record<string, string> = { Accept: 'application/json', Origin: origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers['Cookie'] = this.cookie;
    const response = await fetch(`${appUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
    });
    const setCookie = response.headers.getSetCookie();
    if (setCookie.length > 0) {
      this.rawSetCookie = setCookie[0] ?? '';
      const pair = this.rawSetCookie.split(';')[0] ?? '';
      this.cookie = pair.includes('=') && !/=\s*$/.test(pair) ? pair : '';
    }
    let parsed: Reply['body'] = null;
    try {
      parsed = (await response.json()) as Reply['body'];
    } catch {
      /* not JSON */
    }
    return { status: response.status, headers: response.headers, body: parsed };
  }

  async register(): Promise<void> {
    const reply = await this.call('POST', '/api/v1/auth/register', {
      email: this.email,
      password: PASSWORD,
      displayName: `Verify ${this.label}`,
    });
    assert(reply.status === 201, `register answered ${reply.status}`);
    const user = reply.body?.data?.['user'] as { id?: string } | undefined;
    assert(typeof user?.id === 'string', 'register returned no user id');
    this.userId = user.id;
  }
}

const runId = randomUUID().slice(0, 8);
const email = (label: string) => `verify-${runId}-${label}@verify.example`;
const owner = new Account('Owner', email('owner'));
const viewer = new Account('Viewer', email('viewer'));
const outsider = new Account('Outsider', email('outsider'));

// ───────────── collaboration clients ─────────────

class Collab {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  readonly socket: HocuspocusProviderWebsocket;
  readonly stateless: { type?: string; replyTo?: string; payload?: { code?: string } }[] = [];
  synced = false;
  authFailure: string | null = null;

  constructor(url: string, pageId: string, token: () => Promise<string>, origin: string) {
    class OriginSocket extends WebSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(address, protocols, { headers: { Origin: origin } });
      }
    }
    this.socket = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill: OriginSocket as unknown as typeof globalThis.WebSocket,
      maxAttempts: 0,
      delay: 200,
      minDelay: 100,
      maxDelay: 1_000,
      jitter: false,
    });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: `page:${pageId}`,
      document: this.doc,
      token,
      onSynced: () => {
        this.synced = true;
        const awareness = this.provider.awareness;
        awareness?.setLocalState(awareness.getLocalState() ?? {});
      },
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        this.authFailure = reason;
      },
      onStateless: ({ payload }: { payload: string }) => {
        try {
          this.stateless.push(JSON.parse(payload) as (typeof this.stateless)[number]);
        } catch {
          /* ignore */
        }
      },
    });
    this.provider.attach();
  }

  get fragment(): Y.XmlFragment {
    return this.doc.getXmlFragment('default');
  }
  paragraphs(): string[] {
    return this.fragment.toArray().map((node) => (node as Y.XmlElement).get(0)?.toString() ?? '');
  }
  addParagraph(text: string): void {
    this.doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      this.fragment.insert(this.fragment.length, [paragraph]);
      const node = new Y.XmlText();
      paragraph.insert(0, [node]);
      node.insert(0, text);
    });
  }
  async command(type: 'version.create', payload: Record<string, unknown>) {
    const id = randomUUID();
    this.provider.sendStateless(JSON.stringify({ v: 1, type, id, payload }));
    await until(() => this.stateless.some((m) => m.replyTo === id), `${type} answered`, 10_000);
    return this.stateless.find((m) => m.replyTo === id)!;
  }
  async synced_(): Promise<void> {
    await until(() => this.synced || this.authFailure !== null, 'sync or refusal', 10_000);
    assert(this.authFailure === null, `refused: ${this.authFailure}`);
  }
  close(): void {
    this.provider.destroy();
    this.socket.destroy();
  }
}

async function tokenFor(account: Account, pageId: string) {
  const reply = await account.call('POST', `/api/v1/pages/${pageId}/collab-token`, {});
  assert(reply.status === 200, `collab-token answered ${reply.status}`);
  const data = reply.body?.data as { token: string; collabUrl: string; readOnly: boolean };
  return data;
}

// ───────────── the checks ─────────────

async function main(): Promise<void> {
  console.log(`CoNote deployment verification of ${APP_ORIGIN} (run ${runId})\n`);
  let workspaceId = '';
  let pageId = '';
  let collabUrl = '';

  await check('web: /health answers 200', async () => {
    const response = await fetch(`${appUrl}/health`);
    assert(response.status === 200, `status ${response.status}`);
  });

  if (APP_ORIGIN.startsWith('https://') && process.env['VERIFY_SKIP_HTTP_REDIRECT'] !== '1') {
    await check('transport: plain http redirects to https', async () => {
      const response = await fetch(APP_ORIGIN.replace('https://', 'http://'), {
        redirect: 'manual',
      });
      const location = response.headers.get('location') ?? '';
      assert(
        response.status >= 300 && response.status < 400 && location.startsWith('https://'),
        `status ${response.status}, location ${location || 'none'}`,
      );
    });
  }

  await check('web: security headers (CSP, nosniff, frame denial, HSTS over https)', async () => {
    const response = await fetch(`${appUrl}/login`);
    const h = response.headers;
    assert(Boolean(h.get('content-security-policy')), 'no Content-Security-Policy');
    assert(h.get('x-content-type-options') === 'nosniff', 'no nosniff');
    assert(h.get('x-frame-options') === 'DENY', 'no X-Frame-Options DENY');
    if (APP_ORIGIN.startsWith('https://')) {
      assert(/max-age=\d+/.test(h.get('strict-transport-security') ?? ''), 'no HSTS');
    }
  });

  await check('auth: registration creates three accounts and logs each in', async () => {
    await owner.register();
    await viewer.register();
    await outsider.register();
  });

  await check(
    'auth: session cookie is __Host-, Secure, HttpOnly, SameSite, Path=/, no Domain',
    async () => {
      const raw = owner.rawSetCookie;
      assert(raw !== '', 'no Set-Cookie');
      const attributes = raw.split(';').map((part) => part.trim().toLowerCase());
      const name = (attributes[0] ?? '').split('=')[0] ?? '';
      if (APP_ORIGIN.startsWith('https://')) {
        assert(name.startsWith('__host-'), 'cookie name lacks the __Host- prefix');
        assert(attributes.includes('secure'), 'cookie is not Secure');
      }
      assert(attributes.includes('httponly'), 'cookie is not HttpOnly');
      assert(
        attributes.some((a) => a.startsWith('samesite=')),
        'no SameSite',
      );
      assert(attributes.includes('path=/'), 'Path is not /');
      assert(!attributes.some((a) => a.startsWith('domain=')), 'cookie has a Domain attribute');
    },
  );

  await check('auth: session endpoint works with the cookie and is 401 without it', async () => {
    const withCookie = await owner.call('GET', '/api/v1/auth/session');
    assert(withCookie.status === 200, `with cookie ${withCookie.status}`);
    const anonymous = new Account('Anon', email('anon'));
    const without = await anonymous.call('GET', '/api/v1/auth/session');
    assert(without.status === 401, `without cookie ${without.status}`);
  });

  await check('auth: login with a wrong password is 401', async () => {
    const stranger = new Account('Probe', owner.email);
    const reply = await stranger.call('POST', '/api/v1/auth/login', {
      email: owner.email,
      password: 'definitely-the-wrong-password',
    });
    assert(reply.status === 401, `status ${reply.status}`);
  });

  await check('cors/csrf: a state-changing request from a foreign Origin is refused', async () => {
    const reply = await owner.call(
      'POST',
      '/api/v1/workspaces',
      { name: 'evil' },
      'https://evil.example',
    );
    assert(reply.status === 403, `status ${reply.status}`);
    assert(reply.body?.error?.code === 'INVALID_ORIGIN', `code ${reply.body?.error?.code}`);
  });

  await check('cors: no Access-Control-Allow-Origin is granted to a foreign origin', async () => {
    const response = await fetch(`${appUrl}/api/v1/auth/session`, {
      headers: { Origin: 'https://evil.example', Cookie: owner.cookie },
    });
    const allowed = response.headers.get('access-control-allow-origin');
    assert(allowed === null || allowed === APP_ORIGIN, `allowed origin ${allowed}`);
  });

  await check('workspace: create a workspace and a page', async () => {
    const ws = await owner.call('POST', '/api/v1/workspaces', { name: `Verify ${runId}` });
    assert(ws.status === 201, `workspace ${ws.status}`);
    workspaceId = (ws.body?.data?.['workspace'] as { id: string }).id;
    const page = await owner.call('POST', `/api/v1/workspaces/${workspaceId}/pages`, {
      title: 'Verification page',
    });
    assert(page.status === 201, `page ${page.status}`);
    pageId = (page.body?.data?.['page'] as { id: string }).id;
  });

  await check(
    'permissions: a non-member gets 404 for the page and the collab token (existence hidden)',
    async () => {
      const page = await outsider.call('GET', `/api/v1/pages/${pageId}`);
      assert(page.status === 404, `page ${page.status}`);
      const token = await outsider.call('POST', `/api/v1/pages/${pageId}/collab-token`, {});
      assert(token.status === 404, `token ${token.status}`);
      const list = await outsider.call('GET', `/api/v1/workspaces/${workspaceId}/pages`);
      assert(list.status === 404 || list.status === 403, `list ${list.status}`);
    },
  );

  await check(
    'permissions: invite a VIEWER, accept the invitation, read but not write',
    async () => {
      const invitation = await owner.call('POST', `/api/v1/workspaces/${workspaceId}/invitations`, {
        email: viewer.email,
        role: 'VIEWER',
      });
      assert(invitation.status === 201, `invite ${invitation.status}`);
      const inviteUrl = String(invitation.body?.data?.['inviteUrl'] ?? '');
      const token = new URLSearchParams(new URL(inviteUrl).hash.slice(1)).get('token');
      assert(token, 'invite URL has no token fragment');
      const accepted = await viewer.call('POST', '/api/v1/invitations/accept', { token });
      assert(accepted.status === 200, `accept ${accepted.status}`);
      const read = await viewer.call('GET', `/api/v1/pages/${pageId}`);
      assert(read.status === 200, `viewer read ${read.status}`);
      const write = await viewer.call('PATCH', `/api/v1/pages/${pageId}`, { title: 'hijacked' });
      assert(write.status === 403, `viewer write ${write.status}`);
      const create = await viewer.call('POST', `/api/v1/workspaces/${workspaceId}/pages`, {
        title: 'x',
      });
      assert(create.status === 403, `viewer create ${create.status}`);
    },
  );

  let ownerToken: Awaited<ReturnType<typeof tokenFor>> | undefined;
  await check(
    'collab: the API hands out a wss:// address (https deployments) and a read-only flag for the viewer',
    async () => {
      ownerToken = await tokenFor(owner, pageId);
      collabUrl = ownerToken.collabUrl;
      if (APP_ORIGIN.startsWith('https://'))
        assert(collabUrl.startsWith('wss://'), `collabUrl ${collabUrl}`);
      assert(ownerToken.readOnly === false, 'owner token is read-only');
      const v = await tokenFor(viewer, pageId);
      assert(v.readOnly === true, 'viewer token is not read-only');
      return collabUrl;
    },
  );
  if (!collabUrl) return;

  await check('collab: a WebSocket from a foreign Origin is refused', async () => {
    const t = await tokenFor(owner, pageId);
    const client = new Collab(collabUrl, pageId, async () => t.token, 'https://evil.example');
    try {
      await sleep(3_000);
      assert(!client.synced, 'the foreign origin was served');
    } finally {
      client.close();
    }
  });

  await check('collab: a forged token is refused', async () => {
    const client = new Collab(collabUrl, pageId, async () => 'not.a.token', APP_ORIGIN);
    try {
      await until(() => client.authFailure !== null || client.synced, 'a verdict', 8_000);
      assert(client.authFailure !== null && !client.synced, 'a forged token was accepted');
    } finally {
      client.close();
    }
  });

  const ownerClient = new Collab(
    collabUrl,
    pageId,
    async () => (await tokenFor(owner, pageId)).token,
    APP_ORIGIN,
  );
  const viewerClient = new Collab(
    collabUrl,
    pageId,
    async () => (await tokenFor(viewer, pageId)).token,
    APP_ORIGIN,
  );
  try {
    await check('collab: owner and viewer connect over the cross-origin WebSocket', async () => {
      await ownerClient.synced_();
      await viewerClient.synced_();
    });

    await check('collab: an owner edit reaches the other user live', async () => {
      ownerClient.addParagraph('hello from the owner');
      await until(
        () => viewerClient.paragraphs().includes('hello from the owner'),
        'viewer sees the edit',
      );
    });

    await check(
      'presence: the other user sees the owner with a server-stamped name and a cursor',
      async () => {
        ownerClient.provider.setAwarenessField('cursor', {
          anchor: { item: { client: 1, clock: 1 }, assoc: 0 },
          head: { item: { client: 1, clock: 3 }, assoc: 0 },
        });
        await until(
          () =>
            [...(viewerClient.provider.awareness?.getStates().values() ?? [])].some((state) => {
              const parsed = parseRelayedAwareness(state);
              return parsed?.user.id === owner.userId && parsed.cursor !== undefined;
            }),
          'viewer sees the owner presence',
        );
      },
    );

    await check(
      'permissions: a viewer edit over the WebSocket is not accepted by the server',
      async () => {
        viewerClient.addParagraph('viewer tries to write');
        await sleep(2_500);
        assert(
          !ownerClient.paragraphs().includes('viewer tries to write'),
          'owner received the viewer edit',
        );
        const t = await tokenFor(owner, pageId);
        const fresh = new Collab(collabUrl, pageId, async () => t.token, APP_ORIGIN);
        try {
          await fresh.synced_();
          assert(
            !fresh.paragraphs().includes('viewer tries to write'),
            'the viewer edit was stored',
          );
        } finally {
          fresh.close();
        }
      },
    );

    await check(
      'versions: the owner saves a version over the WebSocket; the viewer may not',
      async () => {
        const ok = await ownerClient.command('version.create', { label: 'Verification' });
        assert(ok.type === 'response', `owner got ${ok.type} ${ok.payload?.code ?? ''}`);
        const denied = await viewerClient.command('version.create', { label: 'nope' });
        assert(
          denied.type === 'error' && denied.payload?.code === 'FORBIDDEN',
          `viewer got ${denied.type}`,
        );
        const list = await owner.call('GET', `/api/v1/pages/${pageId}/versions`);
        const versions = (list.body?.data?.['versions'] ?? []) as { label?: string }[];
        assert(
          versions.some((v) => v.label === 'Verification'),
          'the version is not in the history',
        );
      },
    );

    await check(
      'recovery: an edit made while disconnected reaches the other user after reconnecting',
      async () => {
        ownerClient.socket.disconnect();
        await sleep(500);
        ownerClient.addParagraph('written while offline');
        await sleep(500);
        assert(
          !viewerClient.paragraphs().includes('written while offline'),
          'edit crossed a closed socket',
        );
        ownerClient.synced = false;
        await ownerClient.socket.connect();
        await until(
          () => viewerClient.paragraphs().includes('written while offline'),
          'viewer gets the offline edit',
          20_000,
        );
      },
    );
  } finally {
    ownerClient.close();
    viewerClient.close();
  }

  await check(
    'persistence: with every client gone, a new connection loads the stored document',
    async () => {
      // The server stores a debounced change shortly after the last edit; give it time.
      let loaded: string[] = [];
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const t = await tokenFor(owner, pageId);
        const fresh = new Collab(collabUrl, pageId, async () => t.token, APP_ORIGIN);
        try {
          await fresh.synced_();
          await sleep(500);
          loaded = fresh.paragraphs();
        } finally {
          fresh.close();
        }
        if (loaded.includes('hello from the owner') && loaded.includes('written while offline'))
          break;
        await sleep(2_000);
      }
      assert(
        loaded.includes('hello from the owner') && loaded.includes('written while offline'),
        `loaded ${JSON.stringify(loaded)}`,
      );
      assert(!loaded.includes('viewer tries to write'), 'a rejected edit was persisted');
    },
  );

  await check(
    'comments: the owner starts a thread; the viewer reads it and cannot start one',
    async () => {
      const anchor = Buffer.from('verification-anchor').toString('base64');
      const created = await owner.call('POST', `/api/v1/pages/${pageId}/threads`, {
        anchor: { start: anchor, end: anchor },
        quotedText: 'hello from the owner',
        body: 'A verification comment',
      });
      assert(created.status === 201, `create ${created.status}`);
      const read = await viewer.call('GET', `/api/v1/pages/${pageId}/threads`);
      assert(read.status === 200, `viewer read ${read.status}`);
      const threads = (read.body?.data?.['threads'] ?? []) as unknown[];
      assert(threads.length === 1, `threads ${threads.length}`);
      const denied = await viewer.call('POST', `/api/v1/pages/${pageId}/threads`, {
        anchor: { start: anchor, end: anchor },
        quotedText: 'x',
        body: 'viewer comment',
      });
      assert(denied.status === 403, `viewer create ${denied.status}`);
    },
  );

  await check('permissions: removing the viewer closes access at once', async () => {
    const removed = await owner.call(
      'DELETE',
      `/api/v1/workspaces/${workspaceId}/members/${viewer.userId}`,
      {},
    );
    assert(removed.status === 200, `remove ${removed.status}`);
    const read = await viewer.call('GET', `/api/v1/pages/${pageId}`);
    assert(read.status === 404, `viewer read after removal ${read.status}`);
    const token = await viewer.call('POST', `/api/v1/pages/${pageId}/collab-token`, {});
    assert(token.status === 404, `viewer token after removal ${token.status}`);
  });

  await check('auth: logout ends the session', async () => {
    const out = await owner.call('POST', '/api/v1/auth/logout', {});
    assert(out.status === 200, `logout ${out.status}`);
    const after = await owner.call('GET', '/api/v1/auth/session');
    assert(after.status === 401, `session after logout ${after.status}`);
  });
}

try {
  await main();
} catch (error) {
  results.push({
    name: 'script',
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  console.log(`FAIL  script  (${results.at(-1)?.detail})`);
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length} passed, ${failed.length} failed (${PREFIX} ${runId})`,
);
process.exit(failed.length === 0 ? 0 : 1);
