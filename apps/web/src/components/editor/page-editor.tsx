'use client';

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultRegistry, createEditorExtensions } from '@conote/editor';
import { emptyEditorDocument, type EditorDocument, type PageContentDto } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  AutosaveController,
  trackPendingSave,
  waitForPendingSave,
  type AutosaveState,
} from '@/lib/autosave';
import {
  IMAGE_ACCEPT,
  ImageUploadError,
  checkImageFile,
  uploadPageImage,
} from '@/lib/image-upload';
import { useLoad } from '@/lib/use-load';
import { EditorToolbar } from './editor-toolbar';
import { classifySaveError } from './save-errors';
import { SaveStatus } from './save-status';
import { createSlashMenuRender } from './slash-menu';

const IMAGE_INPUT_ID = 'editor-image-input';

/** Open the image picker. There is one editor per page, so the input is found by its id. */
function openImagePicker(): void {
  document.getElementById(IMAGE_INPUT_ID)?.click();
}

interface Props {
  pageId: string;
  /** Whether the person may edit the page (EDITOR or above). Viewers get a read-only view. */
  canEdit: boolean;
  /** Receives the editor once created; used by tests and future features. */
  onReady?: (editor: Editor) => void;
}

/** Loads a page's document, then shows the editor (or a read-only view). */
export function PageEditor({ pageId, canEdit, onReady }: Props) {
  const load = useCallback(async () => {
    // A save that outlived the previous editor must land before we read the page again.
    await waitForPendingSave(pageId);
    return api.getPageContent(pageId);
  }, [pageId]);
  const { data, error, loading, reload } = useLoad(load);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="animate-pulse space-y-3 py-4"
        aria-label="Loading document"
      >
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-200" />
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <span className="sr-only">Loading document…</span>
      </div>
    );
  }
  if (data === null) {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800"
      >
        <p>{error ?? 'The document could not be loaded.'}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <LoadedEditor
      pageId={pageId}
      canEdit={canEdit}
      initial={data}
      {...(onReady ? { onReady } : {})}
    />
  );
}

function LoadedEditor({ pageId, canEdit, initial, onReady }: Props & { initial: PageContentDto }) {
  const { guard } = useAuth();
  const controllerRef = useRef<AutosaveController | null>(null);
  const initialRevision = useRef(initial.revision);
  const uploadRef = useRef<(files: File[]) => void>(() => undefined);

  const [saveState, setSaveState] = useState<AutosaveState>({
    status: 'saved',
    revision: initial.revision,
    lastSavedAt: null,
    attempt: 0,
  });
  const [contentError, setContentError] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  // Built once: the registry holds the extensions, the host connects them to the page.
  const [extensions] = useState(() =>
    createEditorExtensions(createDefaultRegistry(), {
      host: { requestImage: openImagePicker },
      renderSlashMenu: createSlashMenuRender(),
    }),
  );

  const editor = useEditor({
    extensions,
    content: initial.content ?? emptyEditorDocument(),
    editable: canEdit,
    // Content that does not fit the schema is reported, never silently rewritten and saved.
    enableContentCheck: true,
    onContentError: () => setContentError(true),
    immediatelyRender: false, // the page is server-rendered; the editor mounts on the client
    editorProps: {
      attributes: {
        class: 'conote-prose',
        'aria-label': 'Page content',
        'aria-multiline': 'true',
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        uploadRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || files.length === 0) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at)
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))),
          );
        event.preventDefault();
        uploadRef.current(files);
        return true;
      },
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // Read-only for viewers, and whenever saving is impossible or the content is not trustworthy.
  const blocked = saveState.status === 'blocked';
  useEffect(() => {
    editor?.setEditable(canEdit && !contentError && !blocked);
  }, [editor, canEdit, contentError, blocked]);

  // Autosave.
  useEffect(() => {
    if (!editor || !canEdit || contentError) return;
    const controller = new AutosaveController({
      initialRevision: initialRevision.current,
      getContent: () => editor.getJSON() as EditorDocument,
      save: async (content, baseRevision) => {
        const saved = await guard(() => api.savePageContent(pageId, { baseRevision, content }));
        return { revision: saved.revision };
      },
      classify: classifySaveError,
      onState: setSaveState,
    });
    controllerRef.current = controller;
    const onUpdate = () => controller.notifyChange();
    editor.on('update', onUpdate);

    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') void controller.flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.hasUnsavedChanges()) return;
      void controller.flush();
      event.preventDefault(); // asks the browser to confirm leaving
    };
    const onOnline = () => void controller.flush();
    document.addEventListener('visibilitychange', flushIfHidden);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('online', onOnline);

    return () => {
      editor.off('update', onUpdate);
      document.removeEventListener('visibilitychange', flushIfHidden);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('online', onOnline);
      // Leaving the page: finish the save in the background; the next load waits for it.
      trackPendingSave(pageId, controller.flush());
      controller.dispose();
      controllerRef.current = null;
    };
  }, [editor, canEdit, contentError, pageId, guard]);

  // Images: picker, paste and drop all end up here.
  const uploadFiles = useCallback(
    (files: File[]) => {
      if (!editor || !canEdit) return;
      void (async () => {
        setNotice(null);
        setUploading((n) => n + files.length);
        for (const file of files) {
          try {
            checkImageFile(file);
            const { url, alt } = await uploadPageImage(pageId, file, guard);
            editor.chain().focus().setImage({ src: url, alt }).run();
          } catch (error) {
            setNotice(error instanceof ImageUploadError ? error.message : describeApiError(error));
          } finally {
            setUploading((n) => n - 1);
          }
        }
      })();
    },
    [editor, canEdit, pageId, guard],
  );
  // The editor's paste/drop handlers are created once; they call the latest function.
  useEffect(() => {
    uploadRef.current = uploadFiles;
  }, [uploadFiles]);

  const loadLatest = async () => {
    if (!editor || !controllerRef.current) return;
    setResolving(true);
    try {
      const latest = await guard(() => api.getPageContent(pageId));
      editor.commands.setContent(latest.content ?? emptyEditorDocument(), { emitUpdate: false });
      controllerRef.current.resetToStored(latest.revision);
      setNotice(null);
    } catch (error) {
      setNotice(describeApiError(error));
    } finally {
      setResolving(false);
    }
  };
  const overwrite = async () => {
    if (!controllerRef.current) return;
    setResolving(true);
    try {
      const latest = await guard(() => api.getPageContent(pageId));
      controllerRef.current.resolveConflictByOverwriting(latest.revision);
      setNotice(null);
    } catch (error) {
      setNotice(describeApiError(error));
    } finally {
      setResolving(false);
    }
  };

  if (contentError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800"
      >
        This document contains content this editor cannot display, so it is shown read-only and
        nothing will be saved. Please contact support.
      </div>
    );
  }

  return (
    <div className="conote-editor" data-editable={canEdit ? 'true' : 'false'}>
      {canEdit && editor && (
        <>
          <EditorToolbar
            editor={editor}
            onRequestImage={openImagePicker}
            uploading={uploading > 0}
          />
          <input
            id={IMAGE_INPUT_ID}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            aria-label="Choose images to insert"
            tabIndex={-1}
            onChange={(event) => {
              uploadFiles([...(event.target.files ?? [])]);
              event.target.value = ''; // allow choosing the same file again
            }}
          />
          <div className="mt-2 min-h-6">
            <SaveStatus
              state={saveState}
              busy={resolving}
              onRetry={() => void controllerRef.current?.flush()}
              onLoadLatest={() => void loadLatest()}
              onOverwrite={() => void overwrite()}
            />
          </div>
        </>
      )}
      {!canEdit && (
        <p className="mb-2 text-sm text-slate-500" role="note">
          You have read-only access to this page.
        </p>
      )}
      {notice && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800"
        >
          {notice}
        </p>
      )}
      <EditorContent editor={editor} className="mt-3" />
    </div>
  );
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}
