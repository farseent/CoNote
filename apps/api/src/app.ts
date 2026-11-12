import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { REQUEST_ID_HEADER, isAcceptableRequestId } from '@conote/shared';
import type { Dependencies } from './dependencies.js';
import { registerErrorHandling } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  logger: FastifyBaseLogger;
  dependencies: Dependencies;
}

/** Build the Fastify instance without listening, so tests can use `inject`. */
export function buildApp({ logger, dependencies }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: (req) => {
      const inbound = req.headers[REQUEST_ID_HEADER];
      return isAcceptableRequestId(inbound) ? inbound : randomUUID();
    },
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id);
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, dependencies);

  app.addHook('onClose', async () => {
    await dependencies.close();
  });

  return app;
}
