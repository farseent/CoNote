'use client';

import type { AutosaveState } from '@/lib/autosave';

interface Props {
  state: AutosaveState;
  /** Retry a failed save right away. */
  onRetry: () => void;
  /** After a conflict: replace the editor with the stored version. */
  onLoadLatest: () => void;
  /** After a conflict: keep what is in the editor and save it over the stored version. */
  onOverwrite: () => void;
  busy: boolean;
}

const button =
  'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60';

/** The save indicator under the toolbar; problems that need a decision are alerts. */
export function SaveStatus({ state, onRetry, onLoadLatest, onOverwrite, busy }: Props) {
  const savedAt = state.lastSavedAt;
  switch (state.status) {
    case 'conflict':
      return (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>
            This page was changed somewhere else, for example in another tab, so your latest edits
            are not saved yet. Choose which version to keep.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={onLoadLatest} disabled={busy}>
              Load the latest version (discard my edits)
            </button>
            <button type="button" className={button} onClick={onOverwrite} disabled={busy}>
              Keep my version (replace the stored one)
            </button>
          </div>
        </div>
      );
    case 'blocked':
      return (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          You can no longer save changes to this page (your access changed, or the page was
          removed). Copy anything you need before leaving.
        </p>
      );
    case 'error':
      return (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          This content could not be saved. It may be too large or contain something that is not
          supported. Your edits are still here; changing the page tries again.
        </p>
      );
    case 'retrying':
      return (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-amber-800">
          <span>Can’t save right now. Your changes are kept and we’ll keep trying.</span>
          <button type="button" className={button} onClick={onRetry}>
            Retry now
          </button>
        </p>
      );
    case 'saving':
      return (
        <p role="status" className="text-sm text-slate-600">
          Saving…
        </p>
      );
    case 'dirty':
      return (
        <p role="status" className="text-sm text-slate-600">
          Unsaved changes
        </p>
      );
    default:
      return (
        <p
          role="status"
          className="text-sm text-slate-500"
          title={savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : undefined}
        >
          Saved
        </p>
      );
  }
}
