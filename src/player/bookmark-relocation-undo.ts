let activeUndoId: string | null = null;
let dismissActiveToast: (() => void) | null = null;

export const activateBookmarkRelocationUndo = (undoId: string, onInvalidate: () => void) => {
  if (activeUndoId) {
    dismissActiveToast?.();
  }
  activeUndoId = undoId;
  dismissActiveToast = onInvalidate;
};

export const consumeBookmarkRelocationUndo = (undoId: string) => {
  if (activeUndoId !== undoId) return false;
  activeUndoId = null;
  dismissActiveToast = null;
  return true;
};

export const invalidateBookmarkRelocationUndo = () => {
  if (!activeUndoId) return;
  const dismiss = dismissActiveToast;
  activeUndoId = null;
  dismissActiveToast = null;
  dismiss?.();
};
