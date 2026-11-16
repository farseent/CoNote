import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isUniqueConstraintError } from '@conote/db';
import type { Prisma } from '@conote/db';
import {
  AppError,
  EDITOR_SCHEMA_VERSION,
  PAGE_CONTENT_BODY_LIMIT_BYTES,
  pageContentResponseSchema,
  pageParamsSchema,
  savePageContentRequestSchema,
  savedPageContentResponseSchema,
  successEnvelope,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import type { AccessService } from '../workspaces/access.js';

const conflict = () =>
  new AppError('CONFLICT', 'The page was changed elsewhere. Reload it to continue.');

/**
 * CONTENT-01 and CONTENT-02: interim persistence of editor content as validated ProseMirror
 * JSON (docs/API_CONTRACTS.md §7.1, D54). Phase 6 replaces both with the Yjs document store.
 */
export async function registerPageContentRoutes(
  scope: FastifyInstance,
  { prisma, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  // ───────────── CONTENT-01 Read ─────────────
  app.get(
    '/api/v1/pages/:pageId/content',
    {
      schema: { params: pageParamsSchema, response: { 200: pageContentResponseSchema } },
      config: { rateLimit: rateLimitConfig(config.rateLimits.general) },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      await access.pageAccess(user.id, request.params.pageId); // 404 unless at least VIEWER
      const row = await prisma.pageContent.findUnique({ where: { pageId: request.params.pageId } });
      // The response schema validates stored content again: a document that no longer
      // satisfies the format is a 500 rather than something the editor could overwrite.
      return reply.send(
        successEnvelope({
          content: row === null ? null : (row.content as never),
          schemaVersion: row?.schemaVersion ?? EDITOR_SCHEMA_VERSION,
          revision: row?.revision ?? 0,
          updatedAt: row === null ? null : row.updatedAt.toISOString(),
        }),
      );
    },
  );

  // ───────────── CONTENT-02 Save ─────────────
  app.put(
    '/api/v1/pages/:pageId/content',
    {
      schema: {
        params: pageParamsSchema,
        body: savePageContentRequestSchema,
        response: { 200: savedPageContentResponseSchema },
      },
      bodyLimit: PAGE_CONTENT_BODY_LIMIT_BYTES,
      config: { rateLimit: rateLimitConfig(config.rateLimits.contentSave) },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { pageId } = request.params;
      const { baseRevision, content } = request.body;

      const pageAccess = await access.pageAccess(user.id, pageId);
      access.requirePageRole(pageAccess, 'EDITOR');

      const now = clock();
      const data = {
        schemaVersion: EDITOR_SCHEMA_VERSION,
        content: content as unknown as Prisma.InputJsonValue,
        updatedById: user.id,
        updatedAt: now,
      };

      // Compare-and-set on the revision: of two saves based on the same revision exactly one
      // wins and the other gets 409, so a stale tab cannot silently overwrite newer content.
      const revision = await prisma.$transaction(async (tx) => {
        if (baseRevision === 0) {
          try {
            await tx.pageContent.create({ data: { pageId, revision: 1, ...data } });
          } catch (err) {
            if (isUniqueConstraintError(err)) throw conflict();
            throw err;
          }
          return 1;
        }
        const updated = await tx.pageContent.updateMany({
          where: { pageId, revision: baseRevision },
          data: { ...data, revision: baseRevision + 1 },
        });
        if (updated.count === 0) throw conflict();
        return baseRevision + 1;
      });

      // Keep the page's "last changed" time current for the page tree and activity views.
      await prisma.page.update({ where: { id: pageId }, data: { updatedAt: now } });

      return reply.send(successEnvelope({ revision, updatedAt: now.toISOString() }));
    },
  );
}
