import {
  acceptPdfLocation,
  armPdfNavigation,
  newPdfNavigation,
} from "./pdf-page-navigation";

describe("PDF reader/player navigation feedback", () => {
  it("does not treat opening callbacks or repeated same-page callbacks as reader turns", () => {
    const first = acceptPdfLocation(newPdfNavigation(), 0, 0);
    expect(first.readerTurn).toBe(false);
    expect(acceptPdfLocation(first.state, 0, 100).readerTurn).toBe(false);
    expect(acceptPdfLocation(first.state, 1, 100).readerTurn).toBe(true);
  });
  it("suppresses layout/intermediate callbacks and acknowledges a player-driven jump", () => {
    const state = armPdfNavigation(
      acceptPdfLocation(newPdfNavigation(), 0, 0).state,
      10,
      100,
    );
    const intermediate = acceptPdfLocation(state, 1, 150);
    expect(intermediate.readerTurn).toBe(false);
    const arrived = acceptPdfLocation(intermediate.state, 10, 200);
    expect(arrived.readerTurn).toBe(false);
    expect(arrived.state.pending).toBeNull();
    expect(acceptPdfLocation(arrived.state, 11, 250).readerTurn).toBe(true);
  });
  it("does not permanently swallow manual turns when a native navigation command never lands", () => {
    const state = armPdfNavigation(
      acceptPdfLocation(newPdfNavigation(), 0, 0).state,
      10,
      100,
    );
    expect(acceptPdfLocation(state, 2, 2200).readerTurn).toBe(true);
  });
});
