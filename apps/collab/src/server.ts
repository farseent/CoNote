import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@hocuspocus/server';
import type { Logger } from 'pino';
import { evaluateCollabReadiness, type Liveness, type Readiness } from '@conote/shared';
import type { Dependencies } from './dependencies.js';

const SERVICE = 'collab';

export interface BuildServerOptions {
  port: number;
  /** Bind address. Defaults to all interfaces (container use). */
  address?: string;
  logger: Logger;
  dependencies: Dependencies;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * Phase 1 foundation: a Hocuspocus server that
 *  - answers liveness (/health) and readiness (/ready) over HTTP, and
 *  - REJECTS every document connection. No authentication, persistence or
 *    collaboration exists yet; those are Phase 6 (docs/IMPLEMENTATION_PLAN.md).
 * Rejecting by default is deliberate: Hocuspocus accepts connections unless a
 * hook refuses them, and an open unauthenticated server must never exist.
 */
export function buildCollabServer({
  port,
  address = '0.0.0.0',
  logger,
  dependencies,
}: BuildServerOptions): Server {
  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      const body: Liveness = { status: 'ok', service: SERVICE };
      sendJson(response, 200, body);
      return;
    }
    if (request.method === 'GET' && path === '/ready') {
      const [postgres, redis] = await Promise.all([
        dependencies.checkPostgres(),
        dependencies.checkRedis(),
      ]);
      const status = evaluateCollabReadiness({ postgres, redis });
      const body: Readiness = { status, service: SERVICE, dependencies: { postgres, redis } };
      sendJson(response, status === 'not_ready' ? 503 : 200, body);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  return new Server({
    port,
    address,
    quiet: true,
    stopOnSignals: false,

    async onRequest({ request, response }) {
      try {
        await handleHttp(request, response);
      } catch (err) {
        logger.error({ err }, 'http handler failed');
        if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      }
      // Hocuspocus treats a falsy throw as "response already handled".
      throw null;
    },

    async onConnect({ socketId }) {
      logger.info({ socketId }, 'document connection rejected: collaboration not available');
      throw new Error('Collaboration is not available.');
    },
  });
}
