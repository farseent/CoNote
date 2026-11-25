import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteOptions } from 'fastify';
import { pino } from 'pino';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDependencies } from '../src/dependencies.js';
import { waitUntilReady } from '../src/redis.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { TEST_ORIGIN, testConfig } from './helpers.js';

interface RouteRecord {
  method: string;
  url: string;
  rateLimit: unknown;
}

const UUID = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const infra = {
  ...requireInfraEnv(),
  ASSET_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'conote-inventory-')),
};
const logger = pino({ level: 'silent' });
const deps = createDependencies(infra, logger);
const app = buildApp({ logger, dependencies: deps, config: testConfig() });
const routes: RouteRecord[] = [];
// Added before the deferred route registration runs, so it sees every route.
app.addHook('onRoute', (route: RouteOptions) => {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    if (method === 'HEAD' || method === 'OPTIONS') continue;
    routes.push({
      method,
      url: route.url,
      rateLimit: (route.config as { rateLimit?: unknown } | undefined)?.rateLimit,
    });
  }
});
await app.ready();
await waitUntilReady(deps.redis, 3000);

afterAll(async () => {
  await app.close();
});

// Routes that need no session. Anything else answering without one is a finding.
const PUBLIC = new Set([
  'GET /health',
  'GET /ready',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/invitations/preview',
]);
// Liveness/readiness probes are polled by the orchestrator and carry no data or state.
const UNLIMITED = new Set(['GET /health', 'GET /ready']);
const key = (r: RouteRecord) => `${r.method} ${r.url}`;
const concrete = (url: string) => url.replace(/:[A-Za-z]+/g, UUID);

describe('route inventory (Phase 10)', () => {
  it('registers the routes the contract lists (guards against an empty inventory)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(50);
    expect(new Set(routes.map(key)).size).toBe(routes.length);
  });

  it('every route except the two probes opts in to a finite rate limit', () => {
    const missing = routes
      .filter((r) => !UNLIMITED.has(key(r)))
      .filter((r) => {
        const limit = r.rateLimit as { max?: unknown; timeWindow?: unknown } | undefined;
        return !(
          limit &&
          typeof limit.max === 'number' &&
          limit.max > 0 &&
          typeof limit.timeWindow === 'number' &&
          limit.timeWindow > 0
        );
      })
      .map(key);
    expect(missing).toEqual([]);
  });

  it('every route outside the public list answers 401 without a session', async () => {
    const protectedRoutes = routes.filter((r) => !PUBLIC.has(key(r)));
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(45);
    const wrong: string[] = [];
    for (const route of protectedRoutes) {
      const isUpload = route.method === 'PUT' && route.url.endsWith('/content');
      const res = await app.inject({
        method: route.method as 'GET',
        url: concrete(route.url),
        headers: {
          origin: TEST_ORIGIN,
          'content-type': isUpload ? 'image/png' : 'application/json',
        },
        // Like the web client: every request except GET carries a body.
        ...(route.method === 'GET' ? {} : { payload: isUpload ? Buffer.from([0x89]) : '{}' }),
      });
      if (res.statusCode !== 401) wrong.push(`${key(route)} -> ${res.statusCode}`);
      if (route.url.startsWith('/api/') && res.headers['cache-control'] !== 'no-store')
        wrong.push(`${key(route)} -> Cache-Control ${String(res.headers['cache-control'])}`);
    }
    expect(wrong).toEqual([]);
  });

  it('the public list names only routes that exist', () => {
    const registered = new Set(routes.map(key));
    for (const entry of PUBLIC) expect(registered.has(entry)).toBe(true);
  });
});

// ───────────── malformed input ─────────────

const LEAK = /node_modules|\.ts:\d+|\bat\s+\S+\s+\(|prisma|postgres|SELECT\s|INSERT\s|ECONN|stack/i;
const HOSTILE_PARAMS = [
  'not-a-uuid',
  "'; DROP TABLE users;--",
  '%00',
  '..%2F..%2Fetc%2Fpasswd',
  'a'.repeat(5000),
];
const BODIES: { label: string; body: string }[] = [
  { label: 'truncated JSON', body: '{' },
  { label: 'null', body: 'null' },
  { label: 'array', body: '[]' },
  { label: 'string', body: '"x"' },
  { label: 'prototype pollution', body: '{"__proto__":{"admin":true},"constructor":{"x":1}}' },
  {
    label: 'wrong types',
    body: '{"name":123,"email":{},"role":[],"title":false,"body":null,"token":9}',
  },
  { label: 'deep nesting', body: `${'['.repeat(2000)}${']'.repeat(2000)}` },
  { label: 'oversized', body: JSON.stringify({ name: 'x'.repeat(70 * 1024) }) },
  { label: 'unicode and NUL', body: '{"name":"\\u0000\\ud800","email":"a\\u0000@b.c"}' },
];

describe('malformed input (Phase 10)', () => {
  let cookie = '';

  it('registers a user for the pass', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: `fuzz-${UUID.slice(0, 8)}-${Date.now()}@auth-test.example`,
        password: 'correct horse battery staple',
        displayName: 'Fuzz',
      }),
    });
    expect(res.statusCode).toBe(201);
    const set = res.headers['set-cookie'];
    cookie = String(Array.isArray(set) ? set[0] : set).split(';')[0]!;
    expect(cookie).toContain('=');
  });

  const check = (res: { statusCode: number; body: string; headers: Record<string, unknown> }) => {
    if (res.statusCode === 429 || res.statusCode === 503) return null;
    const problems: string[] = [];
    if (res.statusCode >= 500) problems.push(`status ${res.statusCode}`);
    if (res.statusCode >= 400) {
      try {
        const parsed = JSON.parse(res.body) as { error?: { code?: unknown; message?: unknown } };
        if (typeof parsed.error?.code !== 'string' || typeof parsed.error?.message !== 'string')
          problems.push('not the error envelope');
      } catch {
        problems.push('body is not JSON');
      }
    }
    if (LEAK.test(res.body)) problems.push('leaks internals');
    return problems.length > 0 ? problems.join(', ') : null;
  };

  it('garbage bodies on every state-changing route never cause a 5xx or leak internals', async () => {
    const findings: string[] = [];
    for (const route of routes.filter((r) => r.method !== 'GET')) {
      if (PUBLIC.has(key(route)) && route.url.includes('login')) continue; // covered by rate-limit tests
      if (route.url === '/api/v1/auth/logout') continue;
      const isUpload = route.method === 'PUT' && route.url.endsWith('/content');
      for (const { label, body } of BODIES) {
        const res = await app.inject({
          method: route.method as 'POST',
          url: concrete(route.url),
          headers: {
            origin: TEST_ORIGIN,
            cookie,
            'content-type': isUpload ? 'image/png' : 'application/json',
          },
          payload: isUpload ? Buffer.from(body) : body,
        });
        const problem = check(res);
        if (problem) findings.push(`${key(route)} [${label}] -> ${problem}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('hostile path parameters and query strings never cause a 5xx or leak internals', async () => {
    const findings: string[] = [];
    for (const route of routes.filter((r) => r.url.includes(':') && r.method === 'GET')) {
      for (const hostile of HOSTILE_PARAMS) {
        const res = await app.inject({
          method: 'GET',
          url: route.url.replace(/:[A-Za-z]+/g, encodeURIComponent(hostile)),
          headers: { cookie },
        });
        const problem = check(res);
        if (problem) findings.push(`${key(route)} [param ${hostile.slice(0, 20)}] -> ${problem}`);
      }
      for (const query of ['limit=-1', 'limit=999999999999', 'cursor=%00', 'limit[]=1&limit[]=2']) {
        const res = await app.inject({
          method: 'GET',
          url: `${concrete(route.url)}?${query}`,
          headers: { cookie },
        });
        const problem = check(res);
        if (problem) findings.push(`${key(route)} [?${query}] -> ${problem}`);
      }
    }
    expect(findings).toEqual([]);
  });
});

// ───────────── CORS and Origin (NFR-SEC-04) ─────────────

describe('CORS allow-list and Origin validation (Phase 10)', () => {
  const preflight = (origin: string) =>
    app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

  it('answers a preflight from an allow-listed origin with that origin and credentials, never *', async () => {
    const res = await preflight(TEST_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('gives a foreign origin no Access-Control-Allow-Origin, so a browser refuses it', async () => {
    for (const origin of ['https://evil.example', 'null', `${TEST_ORIGIN}.evil.example`]) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    const simple = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a state-changing request from a foreign origin or without an Origin header (CSRF)', async () => {
    for (const origin of ['https://evil.example', undefined]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        payload: JSON.stringify({ email: 'a@b.example', password: 'x'.repeat(12) }),
      });
      expect(res.statusCode, String(origin)).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_ORIGIN');
    }
  });
});
