import type { Connection } from '@hocuspocus/server';
import type { EffectivePageRole } from '@conote/shared';

/**
 * What the server knows about one open document connection (docs/WEBSOCKET_PROTOCOL.md §4).
 * It is created from the verified token and the database, never from client messages.
 * Hocuspocus hands this object back as `context` in every later hook.
 */
export interface CollabContext {
  userId: string;
  sessionId: string;
  pageId: string;
  workspaceId: string;
  role: Exclude<EffectivePageRole, 'NONE'>;
  readOnly: boolean;
  connectedAt: number;
  /** The token's id, for logs only. */
  tokenId: string;
  /** Set when the connection is registered. */
  connection: Connection | undefined;
  /** Once true, every further message of the connection is dropped. */
  revoked: boolean;
  /** Rate limiting window (see `ConnectionRegistry.allowMessage`). */
  windowStartedAt: number;
  windowCount: number;
  /** Invalid application messages so far. */
  violations: number;
  /** Updates dropped because the connection is read-only (logged once per few drops). */
  droppedWrites: number;
  /** Releases the connection-limit reservation made while authenticating. */
  release: (() => void) | undefined;
}

export function createContext(
  input: Pick<
    CollabContext,
    'userId' | 'sessionId' | 'pageId' | 'workspaceId' | 'role' | 'readOnly' | 'tokenId'
  >,
  now: number,
): CollabContext {
  return {
    ...input,
    connectedAt: now,
    connection: undefined,
    revoked: false,
    windowStartedAt: now,
    windowCount: 0,
    violations: 0,
    droppedWrites: 0,
    release: undefined,
  };
}

const RESERVATION_TIMEOUT_MS = 30_000;

/** The open connections of this instance, for limits, access events and revalidation. */
export class ConnectionRegistry {
  private readonly all = new Set<CollabContext>();
  private readonly perUser = new Map<string, number>();
  /** Connections that passed authentication but are not registered yet (closes a race on limits). */
  private reservedTotal = 0;
  private readonly reservedPerUser = new Map<string, number>();

  get size(): number {
    return this.all.size;
  }

  countForUser(userId: string): number {
    return this.perUser.get(userId) ?? 0;
  }

  /**
   * Reserve a slot while a connection is being authenticated, so many simultaneous connects
   * cannot all pass the limit check before any of them is registered. `release` must be
   * called exactly once, when the connection registers or fails.
   */
  reserve(userId: string, limits: { perUser: number; total: number }): (() => void) | null {
    const user = this.countForUser(userId) + (this.reservedPerUser.get(userId) ?? 0);
    if (user >= limits.perUser || this.all.size + this.reservedTotal >= limits.total) return null;
    this.reservedTotal += 1;
    this.reservedPerUser.set(userId, (this.reservedPerUser.get(userId) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(expiry);
      this.reservedTotal -= 1;
      const left = (this.reservedPerUser.get(userId) ?? 1) - 1;
      if (left <= 0) this.reservedPerUser.delete(userId);
      else this.reservedPerUser.set(userId, left);
    };
    // A connection that authenticated but never finished opening must not hold a slot forever.
    const expiry = setTimeout(release, RESERVATION_TIMEOUT_MS);
    expiry.unref();
    return release;
  }

  add(context: CollabContext): void {
    if (this.all.has(context)) return;
    this.all.add(context);
    this.perUser.set(context.userId, this.countForUser(context.userId) + 1);
  }

  remove(context: CollabContext): void {
    if (!this.all.delete(context)) return;
    const left = this.countForUser(context.userId) - 1;
    if (left <= 0) this.perUser.delete(context.userId);
    else this.perUser.set(context.userId, left);
  }

  snapshot(): CollabContext[] {
    return [...this.all];
  }

  matching(predicate: (context: CollabContext) => boolean): CollabContext[] {
    return [...this.all].filter(predicate);
  }

  /**
   * Count one inbound message; `false` once the connection exceeds `maxPerSecond` in the current
   * one-second window. A fixed window is enough here: the limit only has to stop floods.
   */
  allowMessage(context: CollabContext, now: number, maxPerSecond: number): boolean {
    if (now - context.windowStartedAt >= 1000) {
      context.windowStartedAt = now;
      context.windowCount = 0;
    }
    context.windowCount += 1;
    return context.windowCount <= maxPerSecond;
  }
}
