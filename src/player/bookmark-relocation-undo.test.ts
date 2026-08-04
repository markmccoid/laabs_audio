import {
  activateBookmarkRelocationUndo,
  consumeBookmarkRelocationUndo,
  invalidateBookmarkRelocationUndo,
} from "./bookmark-relocation-undo";

describe("bookmark relocation undo", () => {
  afterEach(() => invalidateBookmarkRelocationUndo());

  it("consumes only the active undo token", () => {
    const dismiss = jest.fn();
    activateBookmarkRelocationUndo("undo-1", dismiss);

    expect(consumeBookmarkRelocationUndo("other")).toBe(false);
    expect(consumeBookmarkRelocationUndo("undo-1")).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("dismisses the toast when a later action invalidates undo", () => {
    const dismiss = jest.fn();
    activateBookmarkRelocationUndo("undo-1", dismiss);

    invalidateBookmarkRelocationUndo();

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(consumeBookmarkRelocationUndo("undo-1")).toBe(false);
  });

  it("invalidates an older token when a new relocation is activated", () => {
    const dismissFirst = jest.fn();
    activateBookmarkRelocationUndo("undo-1", dismissFirst);

    activateBookmarkRelocationUndo("undo-2", jest.fn());

    expect(dismissFirst).toHaveBeenCalledTimes(1);
    expect(consumeBookmarkRelocationUndo("undo-1")).toBe(false);
    expect(consumeBookmarkRelocationUndo("undo-2")).toBe(true);
  });
});
