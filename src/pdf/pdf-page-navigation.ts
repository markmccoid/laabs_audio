/** A navigator command must never become a reader-led audio seek, including opening/layout callbacks. */
export type PdfNavigationState = {
  displayed: number | null;
  pending: { page: number; expiresAt: number } | null;
  initialized: boolean;
};

export const newPdfNavigation = (): PdfNavigationState => ({
  displayed: null,
  pending: null,
  initialized: false,
});

export const armPdfNavigation = (
  state: PdfNavigationState,
  page: number,
  nowMs: number,
): PdfNavigationState => ({
  ...state,
  pending: { page, expiresAt: nowMs + 2000 },
});

export const acceptPdfLocation = (
  state: PdfNavigationState,
  page: number,
  nowMs: number,
): {
  state: PdfNavigationState;
  readerTurn: boolean;
} => {
  const pending = state.pending;
  if (pending && page === pending.page) {
    return {
      state: { displayed: page, pending: null, initialized: true },
      readerTurn: false,
    };
  }
  if (pending && nowMs < pending.expiresAt) {
    // Opening/relayout can emit the old location while a native jump is in flight.
    return { state: { ...state, displayed: page }, readerTurn: false };
  }
  const readerTurn = state.initialized && page !== state.displayed;
  return {
    state: { displayed: page, pending: null, initialized: true },
    readerTurn,
  };
};
