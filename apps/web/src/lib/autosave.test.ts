import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyEditorDocument, type EditorDocument } from '@conote/shared';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AutosaveController,
  trackPendingSave,
  waitForPendingSave,
  type AutosaveState,
  type SaveFailure,
} from './autosave';

const doc = (text: string): EditorDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function setup(options: { revision?: number; failures?: SaveFailure[] } = {}) {
  let current = emptyEditorDocument();
  const states: AutosaveState[] = [];
  const failures = [...(options.failures ?? [])];
  const resolvers: (() => void)[] = [];
  let hold = false;
  const save = vi.fn(async (content: EditorDocument, base: number) => {
    if (hold) await new Promise<void>((resolve) => resolvers.push(resolve));
    const failure = failures.shift();
    if (failure !== undefined) throw Object.assign(new Error('boom'), { failure });
    void content;
    return { revision: base + 1 };
  });
  const controller = new AutosaveController({
    initialRevision: options.revision ?? 0,
    getContent: () => current,
    save,
    classify: (error) => (error as { failure: SaveFailure }).failure,
    onState: (state) => states.push(state),
    now: () => new Date('2026-11-15T10:00:00.000Z'),
  });
  return {
    controller,
    save,
    states,
    type: (text: string) => {
      current = doc(text);
      controller.notifyChange();
    },
    holdSaves: () => {
      hold = true;
    },
    releaseSave: async () => {
      hold = false;
      resolvers.splice(0).forEach((resolve) => resolve());
      await vi.advanceTimersByTimeAsync(0);
    },
    last: () => states[states.length - 1]!,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AutosaveController', () => {
  it('starts saved and waits for the debounce before saving', async () => {
    const t = setup();
    expect(t.controller.getState().status).toBe('saved');
    t.type('a');
    expect(t.last().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(t.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.save).toHaveBeenCalledWith(doc('a'), 0);
    expect(t.last()).toMatchObject({ status: 'saved', revision: 1 });
    expect(t.last().lastSavedAt).toEqual(new Date('2026-11-15T10:00:00.000Z'));
    expect(t.controller.hasUnsavedChanges()).toBe(false);
  });

  it('restarts the debounce on every change and saves once with the latest content', async () => {
    const t = setup();
    t.type('a');
    await vi.advanceTimersByTimeAsync(1000);
    t.type('ab');
    await vi.advanceTimersByTimeAsync(1000);
    t.type('abc');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.save).toHaveBeenCalledWith(doc('abc'), 0);
  });

  it('still saves during continuous typing (max wait)', async () => {
    const t = setup();
    for (let elapsed = 0; elapsed <= AUTOSAVE_MAX_WAIT_MS; elapsed += 1000) {
      t.type(`x${elapsed}`);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(t.save).toHaveBeenCalled();
  });

  it('never has two saves in flight; changes made meanwhile are saved afterwards with the new revision', async () => {
    const t = setup();
    t.holdSaves();
    t.type('one');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.last().status).toBe('saving');
    t.type('two');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(t.save).toHaveBeenCalledOnce();
    await t.releaseSave();
    expect(t.last().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save).toHaveBeenLastCalledWith(doc('two'), 1);
    expect(t.last()).toMatchObject({ status: 'saved', revision: 2 });
  });

  it('retries transient failures with growing delays and keeps the changes', async () => {
    const t = setup({ failures: ['retry', 'retry'] });
    t.type('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.last()).toMatchObject({ status: 'retrying', attempt: 1 });
    expect(t.controller.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.last()).toMatchObject({ status: 'retrying', attempt: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.save).toHaveBeenCalledTimes(3);
    expect(t.last()).toMatchObject({ status: 'saved', attempt: 0, revision: 1 });
  });

  it('stops at a conflict and ignores further changes until resolved', async () => {
    const t = setup({ failures: ['conflict'] });
    t.type('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.last().status).toBe('conflict');
    t.type('b');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledOnce();
    await t.controller.flush();
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.controller.hasUnsavedChanges()).toBe(true);
  });

  it('can overwrite after a conflict on top of the latest revision', async () => {
    const t = setup({ revision: 3, failures: ['conflict'] });
    t.type('mine');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    t.controller.resolveConflictByOverwriting(9);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.save).toHaveBeenLastCalledWith(doc('mine'), 9);
    expect(t.last()).toMatchObject({ status: 'saved', revision: 10 });
  });

  it('can adopt stored content after a conflict', async () => {
    const t = setup({ failures: ['conflict'] });
    t.type('mine');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    t.controller.resetToStored(7);
    expect(t.last()).toMatchObject({ status: 'saved', revision: 7 });
    expect(t.controller.hasUnsavedChanges()).toBe(false);
    t.type('next');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.save).toHaveBeenLastCalledWith(doc('next'), 7);
  });

  it('stops for good when saving is no longer allowed', async () => {
    const t = setup({ failures: ['blocked'] });
    t.type('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.last().status).toBe('blocked');
    t.type('b');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.last().status).toBe('blocked');
  });

  it('does not retry refused content, but tries again after the next change', async () => {
    const t = setup({ failures: ['refused'] });
    t.type('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.last().status).toBe('error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledOnce();
    t.type('a2');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.last().status).toBe('saved');
  });

  it('flush saves immediately and does nothing when there is nothing to save', async () => {
    const t = setup();
    await t.controller.flush();
    expect(t.save).not.toHaveBeenCalled();
    t.type('a');
    await t.controller.flush();
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.last().status).toBe('saved');
  });

  it('flush while saving waits for that save', async () => {
    const t = setup();
    t.holdSaves();
    t.type('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    const flushed = t.controller.flush();
    await t.releaseSave();
    await flushed;
    expect(t.save).toHaveBeenCalledOnce();
  });

  it('after dispose, no timers fire and no state is reported', async () => {
    const t = setup();
    t.type('a');
    const reported = t.states.length;
    t.controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).not.toHaveBeenCalled();
    expect(t.states.length).toBe(reported);
  });
});

describe('pending saves outlive the editor', () => {
  it('waitForPendingSave resolves once the tracked save settles', async () => {
    let finish!: () => void;
    trackPendingSave('page-1', new Promise<void>((resolve) => (finish = resolve)));
    let waited = false;
    const waiting = waitForPendingSave('page-1').then(() => (waited = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(waited).toBe(false);
    finish();
    await waiting;
    expect(waited).toBe(true);
    await expect(waitForPendingSave('page-1')).resolves.toBeUndefined();
    await expect(waitForPendingSave('unknown')).resolves.toBeUndefined();
  });
});
