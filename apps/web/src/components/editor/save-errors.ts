import { ApiError } from '@/lib/api-client';
import type { SaveFailure } from '@/lib/autosave';

/**
 * What a failed autosave means. Anything not clearly permanent is retried: the changes stay
 * in the editor, so waiting costs nothing and giving up could lose work.
 */
export function classifySaveError(error: unknown): SaveFailure {
  if (!(error instanceof ApiError)) return 'retry';
  switch (error.status) {
    case 401: // signed out: the auth guard sends the user to the login page
    case 403: // role was reduced
    case 404: // page deleted or access removed
      return 'blocked';
    case 409:
      return 'conflict';
    case 400:
    case 413:
    case 415:
      return 'refused';
    default:
      return 'retry'; // network failure (0), 429, 5xx, anything unexpected
  }
}
