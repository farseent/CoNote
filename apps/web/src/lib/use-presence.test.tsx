// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from './use-presence';

afterEach(cleanup);

const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada', color: '#4F46E5' };
const BOB = { id: '22222222-2222-4222-8222-222222222222', name: 'Bob', color: '#0E7490' };

function remote(awareness: Awareness, clientId: number, state: object | null, clock: number) {
  const other = new Awareness(new Y.Doc());
  other.clientID = clientId;
  other.meta.set(clientId, { clock, lastUpdated: Date.now() });
  if (state) other.states.set(clientId, state);
  applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [clientId]), 'test');
  other.destroy();
}

const cursorAt = (clock: number) => ({
  anchor: { type: { client: 1, clock: 0 }, tname: null, item: { client: 1, clock }, assoc: 0 },
  head: { type: { client: 1, clock: 0 }, tname: null, item: { client: 1, clock }, assoc: 0 },
});

describe('usePresence re-render cost (Phase 10)', () => {
  it('a collaborator moving their cursor does not re-render the host component', () => {
    vi.useFakeTimers();
    try {
      const awareness = new Awareness(new Y.Doc());
      let renders = 0;
      function Host() {
        renders += 1;
        usePresence(awareness, true, ADA);
        return null;
      }
      render(<Host />);
      act(() => vi.advanceTimersByTime(2000));
      act(() => remote(awareness, 101, { user: BOB, cursor: cursorAt(0) }, 1));
      // React may call a component once more for the first state update that changes nothing,
      // before it bails out without rendering (a documented behaviour); one move absorbs that.
      act(() => remote(awareness, 101, { user: BOB, cursor: cursorAt(1) }, 2));
      const before = renders;
      for (let i = 2; i <= 51; i += 1) {
        act(() => remote(awareness, 101, { user: BOB, cursor: cursorAt(i) }, i + 1));
      }
      expect(renders - before).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still updates when something people can see changes', () => {
    vi.useFakeTimers();
    try {
      const awareness = new Awareness(new Y.Doc());
      let latest: ReturnType<typeof usePresence> | null = null;
      function Host() {
        latest = usePresence(awareness, true, ADA);
        return null;
      }
      render(<Host />);
      act(() => vi.advanceTimersByTime(2000));
      act(() => remote(awareness, 101, { user: BOB }, 1));
      expect(latest!.collaborators.map((c) => c.name)).toEqual(['Ada', 'Bob']);
      expect(latest!.collaborators[1]!.hasCursor).toBe(false);
      act(() => remote(awareness, 101, { user: BOB, cursor: cursorAt(0) }, 2));
      expect(latest!.collaborators[1]!.hasCursor).toBe(true);
      act(() => remote(awareness, 102, { user: BOB }, 1)); // second tab
      expect(latest!.collaborators[1]!.connections).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
