/**
 * End-to-end latency of a RUNNING deployment, measured from where this script runs
 * (docs/DEPLOYMENT.md §15 D, docs/PERFORMANCE.md §9).
 *
 *   VERIFY_APP_URL=https://app.example.com pnpm measure:deployment
 *
 * Two numbers matter to a user: how long a REST call takes through the proxy, and how long an edit
 * takes to appear in another browser over the WebSocket. It registers ONE throw-away account and
 * workspace, then (1) times authenticated `GET /api/v1/auth/session`, (2) times the arrival of
 * an edit from one connection at another connection of the same account, over the public
 * `wss://` address. The result describes the path from THIS machine; run it from the place you
 * care about. It is a small sample, not a load test: it does not find limits.
 *
 * Variables: VERIFY_APP_URL (required), VERIFY_INSECURE_TLS=1 (local CA only), MEASURE_SAMPLES
 * (default 200, 20..2000).
 */
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

if (process.env['VERIFY_INSECURE_TLS'] === '1') process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
const appUrl = (process.env['VERIFY_APP_URL'] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(appUrl)) {
  console.error('Set VERIFY_APP_URL to the web origin, for example https://app.example.com');
  process.exit(2);
}
const ORIGIN = new URL(appUrl).origin;
const SAMPLES = Math.min(2000, Math.max(20, Number(process.env['MEASURE_SAMPLES'] ?? 200) || 200));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Accept: 'application/json', Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const response = await fetch(`${appUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const set = response.headers.getSetCookie()[0];
  if (set) cookie = set.split(';')[0] ?? '';
  const json = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
  } | null;
  return { status: response.status, data: json?.data };
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    max: round(sorted.at(-1)!),
  };
}

function client(url: string, pageId: string, token: () => Promise<string>) {
  class OriginSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { headers: { Origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url,
    WebSocketPolyfill: OriginSocket as unknown as typeof globalThis.WebSocket,
    maxAttempts: 0,
  });
  let synced = false;
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `page:${pageId}`,
    document: doc,
    token,
    onSynced: () => (synced = true),
  });
  provider.attach();
  return {
    doc,
    isSynced: () => synced,
    close: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

const email = `measure-${randomUUID().slice(0, 8)}@verify.example`;
const registered = await api('POST', '/api/v1/auth/register', {
  email,
  password: 'measure-deployment-passphrase-1',
  displayName: 'Measure',
});
if (registered.status !== 201) throw new Error(`register answered ${registered.status}`);
const ws = await api('POST', '/api/v1/workspaces', { name: 'Measure' });
const workspaceId = (ws.data?.['workspace'] as { id: string }).id;
const page = await api('POST', `/api/v1/workspaces/${workspaceId}/pages`, { title: 'Measure' });
const pageId = (page.data?.['page'] as { id: string }).id;

// 1. REST through the proxy
for (let i = 0; i < 10; i += 1) await api('GET', '/api/v1/auth/session'); // warm-up
const rest: number[] = [];
for (let i = 0; i < SAMPLES; i += 1) {
  const start = performance.now();
  const reply = await api('GET', '/api/v1/auth/session');
  if (reply.status !== 200) throw new Error(`session answered ${reply.status}`);
  rest.push(performance.now() - start);
}

// 2. Edit-to-other-connection over wss
const tokenOf = async () => {
  const reply = await api('POST', `/api/v1/pages/${pageId}/collab-token`, {});
  if (reply.status !== 200) throw new Error(`collab-token answered ${reply.status}`);
  return reply.data as { token: string; collabUrl: string };
};
const first = await tokenOf();
const writer = client(first.collabUrl, pageId, async () => (await tokenOf()).token);
const reader = client(first.collabUrl, pageId, async () => (await tokenOf()).token);
const deadline = Date.now() + 15_000;
while (!(writer.isSynced() && reader.isSynced())) {
  if (Date.now() > deadline) throw new Error('the two connections did not sync');
  await sleep(50);
}
const fragment = (doc: Y.Doc) => doc.getXmlFragment('default');
const sync: number[] = [];
for (let i = 0; i < SAMPLES + 20; i += 1) {
  const before = fragment(reader.doc).length;
  const arrived = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('an edit did not arrive within 10 s')), 10_000);
    const check = () => {
      if (fragment(reader.doc).length > before) {
        clearTimeout(timer);
        fragment(reader.doc).unobserve(check);
        resolve(performance.now());
      }
    };
    fragment(reader.doc).observe(check);
  });
  const start = performance.now();
  writer.doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    fragment(writer.doc).insert(fragment(writer.doc).length, [paragraph]);
  });
  const end = await arrived;
  if (i >= 20) sync.push(end - start); // the first 20 are warm-up
  await sleep(30);
}
writer.close();
reader.close();

console.log(
  JSON.stringify(
    {
      target: ORIGIN,
      samples: SAMPLES,
      note: 'measured from the machine that ran this script; one account; not a load test',
      restSessionMs: percentiles(rest),
      editToOtherConnectionMs: percentiles(sync),
    },
    null,
    2,
  ),
);
process.exit(0);
