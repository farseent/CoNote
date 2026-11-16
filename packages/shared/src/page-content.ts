import { z } from 'zod';
import { successEnvelopeSchema } from './auth.js';
import { MAX_DOCUMENT_BYTES, editorDocumentSchema } from './editor-content.js';

/**
 * Interim page-content endpoints `CONTENT-01` and `CONTENT-02` (docs/API_CONTRACTS.md §7.1, D54).
 * They exist only until Phase 6 replaces document persistence with the Yjs document store;
 * nothing else should depend on them. Pure: no I/O. Request schemas reject unknown fields.
 */

/** Request body limit of `CONTENT-02`: the document limit plus room for the envelope. */
export const PAGE_CONTENT_BODY_LIMIT_BYTES = MAX_DOCUMENT_BYTES + 4 * 1024;

/** `revision` counts saved versions of a page's content; `0` means nothing was ever saved. */
const revisionSchema = z.number().int().min(0).max(2_000_000_000);

export const savePageContentRequestSchema = z.strictObject({
  /** The revision the client's copy is based on; a different stored revision is a conflict. */
  baseRevision: revisionSchema,
  content: editorDocumentSchema,
});
export type SavePageContentRequest = z.infer<typeof savePageContentRequestSchema>;

export const pageContentSchema = z.object({
  /** `null` when the page has never been edited. */
  content: editorDocumentSchema.nullable(),
  schemaVersion: z.number().int().min(1),
  revision: revisionSchema,
  updatedAt: z.iso.datetime().nullable(),
});
export type PageContentDto = z.infer<typeof pageContentSchema>;

export const pageContentResponseSchema = successEnvelopeSchema(pageContentSchema);

export const savedPageContentSchema = z.object({
  revision: revisionSchema,
  updatedAt: z.iso.datetime(),
});
export type SavedPageContentDto = z.infer<typeof savedPageContentSchema>;

export const savedPageContentResponseSchema = successEnvelopeSchema(savedPageContentSchema);
