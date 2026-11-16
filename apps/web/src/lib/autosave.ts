import type { EditorDocument } from '@conote/shared';

/**
 * Autosave state machine for the editor (D54). Pure of React and of the editor: it is given
 * a way to read the current document and a way to save it, and reports its state. The server
 * is the judge of conflicts: every save carries the revision it is based on.
 *
 * Behaviour:
 * - a change starts a debounce timer; continuous typing still saves every `maxWaitMs`;
 * - at most one save is in flight; changes made meanwhile cause one more save afterwards;
 * - network errors and 5xx/429 are retried with growing delays and the changes stay unsaved;
 * - a conflict, a lost permission or a deleted page stops saving and is reported;
 * - content the server refuses (invalid or too large) is not retried until the next change.
 */
export type SaveStatus =
  | 'saved' // everything typed so far is stored
  | 'dirty' // changes waiting for the debounce
  | 'saving' // a request is in flight
  | 'retrying' // the last attempt failed for a transient reason; waiting to try again
  | 'error' // the server refused this content; the next change tries again
  | 'conflict' // the stored page changed elsewhere
  | 'blocked'; // no longer allowed to save (permission lost, page gone, signed out)

export type SaveFailure = 'retry' | 'conflict' | 'blocked' | 'refused';

export interface AutosaveState {
  status: SaveStatus;
  revision: number;
  lastSavedAt: Date | null;
  /** Consecutive failed attempts (drives the retry delay); 0 when the last save worked. */
  attempt: number;
}

export interface AutosaveOptions {
  initialRevision: number;
  getContent: () => EditorDocument;
  save: (content: EditorDocument, baseRevision: number) => Promise<{ revision: number }>;
  /** Decide what a failed save means. */
  classify: (error: unknown) => SaveFailure;
  onState: (state: AutosaveState) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
}

export const AUTOSAVE_DEBOUNCE_MS = 1500;
export const AUTOSAVE_MAX_WAIT_MS = 10_000;
export const AUTOSAVE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export class AutosaveController {
  private readonly options: Required<Omit<AutosaveOptions, 'initialRevision'>>;
  private revision: number;
  private status: SaveStatus = 'saved';
  private lastSavedAt: Date | null = null;
  private attempt = 0;
  /** Counts changes; `savedVersion` is the count covered by the last successful save. */
  private version = 0;
  private savedVersion = 0;
  private inflight: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(options: AutosaveOptions) {
    this.revision = options.initialRevision;
    this.options = {
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
      maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
      retryDelaysMs: AUTOSAVE_RETRY_DELAYS_MS,
      now: () => new Date(),
      ...options,
    };
  }

  getState(): AutosaveState {
    return {
      status: this.status,
      revision: this.revision,
      lastSavedAt: this.lastSavedAt,
      attempt: this.attempt,
    };
  }

  /** True while typed changes are not stored yet. */
  hasUnsavedChanges(): boolean {
    return this.version > this.savedVersion;
  }

  /** Call after every document change. */
  notifyChange(): void {
    if (this.disposed) return;
    this.version += 1;
    if (this.status === 'conflict' || this.status === 'blocked') return;
    if (this.inflight === null) this.setStatus(this.status === 'retrying' ? 'retrying' : 'dirty');
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.run(), this.options.debounceMs);
    this.maxWaitTimer ??= setTimeout(() => void this.run(), this.options.maxWaitMs);
  }

  /** Save now (tab hidden, leaving the page, "retry" button). Resolves when that attempt ends. */
  async flush(): Promise<void> {
    if (this.status === 'conflict' || this.status === 'blocked') return;
    if (this.inflight !== null) return this.inflight;
    if (!this.hasUnsavedChanges()) return;
    await this.run();
  }

  /** The user chose to keep their version after a conflict: save on top of `latestRevision`. */
  resolveConflictByOverwriting(latestRevision: number): void {
    this.revision = latestRevision;
    this.attempt = 0;
    this.setStatus('dirty');
    void this.run();
  }

  /** The editor now shows the stored content of `revision`; nothing is unsaved. */
  resetToStored(revision: number): void {
    this.clearTimers();
    this.revision = revision;
    this.savedVersion = this.version;
    this.attempt = 0;
    this.setStatus('saved');
  }

  /** Stop all timers and future notifications; an in-flight save still completes. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxWaitTimer);
    clearTimeout(this.retryTimer);
    this.debounceTimer = undefined;
    this.maxWaitTimer = undefined;
    this.retryTimer = undefined;
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    if (!this.disposed) this.options.onState(this.getState());
  }

  private run(): Promise<void> {
    this.clearTimers();
    if (this.inflight !== null) return this.inflight;
    if (this.status === 'conflict' || this.status === 'blocked') return Promise.resolve();
    if (!this.hasUnsavedChanges()) return Promise.resolve();

    const startedAt = this.version;
    const base = this.revision;
    this.setStatus('saving');
    const attempt = (async () => {
      try {
        const saved = await this.options.save(this.options.getContent(), base);
        this.revision = saved.revision;
        this.savedVersion = startedAt;
        this.lastSavedAt = this.options.now();
        this.attempt = 0;
        if (this.version > startedAt && !this.disposed) {
          // Changes arrived during the request: another save follows after the debounce.
          this.setStatus('dirty');
          this.debounceTimer = setTimeout(() => void this.run(), this.options.debounceMs);
        } else {
          this.setStatus('saved');
        }
      } catch (error) {
        this.handleFailure(error);
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = attempt;
    return attempt;
  }

  private handleFailure(error: unknown): void {
    const failure = this.options.classify(error);
    if (failure === 'conflict') {
      this.setStatus('conflict');
    } else if (failure === 'blocked') {
      this.setStatus('blocked');
    } else if (failure === 'refused') {
      this.attempt = 0;
      this.setStatus('error');
    } else {
      const delays = this.options.retryDelaysMs;
      const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 30_000;
      this.attempt += 1;
      this.setStatus('retrying');
      if (!this.disposed) this.retryTimer = setTimeout(() => void this.run(), delay);
    }
  }
}

// ───────────── Saves that outlive the editor ─────────────

const pendingSaves = new Map<string, Promise<void>>();

/** Remember a save that continues after its editor unmounted (e.g. navigating to another page). */
export function trackPendingSave(pageId: string, save: Promise<void>): void {
  const tracked = save.finally(() => {
    if (pendingSaves.get(pageId) === tracked) pendingSaves.delete(pageId);
  });
  pendingSaves.set(pageId, tracked);
}

/** Resolves once no save of `pageId` is in flight, so a reload never reads stale content. */
export async function waitForPendingSave(pageId: string): Promise<void> {
  await pendingSaves.get(pageId);
}
