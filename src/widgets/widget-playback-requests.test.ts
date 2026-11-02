import type { PlaybackState } from "../player/types";
import { startWidgetPlaybackRequests } from "./widget-playback-requests";

type Listener<T> = (state: T, previousState: T) => void;

const createStore = <T,>(initial: T) => {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    getState: () => state,
    setState: (next: T) => {
      const previous = state;
      state = next;
      listeners.forEach((listener) => listener(state, previous));
    },
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const setup = ({
  hasPending = true,
  authStatus = "authenticated" as "hydrating" | "authenticated",
  libraryItemId = "book-1" as string | null,
  episodeId = null as string | null,
} = {}) => {
  let widgetListener: ((event: { type?: string }) => void) | null = null;
  const consumePendingPlayRequest = jest.fn().mockResolvedValueOnce(hasPending).mockResolvedValue(false);
  const requestStart = jest
    .fn()
    .mockResolvedValue({ status: "accepted", intentId: "intent-1" });
  const abandonPlayRequest = jest.fn();
  const cancelStart = jest.fn().mockResolvedValue(undefined);
  const playback = createStore({ libraryItemId, episodeId, playbackState: "idle" as PlaybackState });
  const auth = createStore({ status: authStatus });

  startWidgetPlaybackRequests({
    consumePendingPlayRequest,
    abandonPlayRequest,
    addWidgetEventListener: (listener) => {
      widgetListener = listener;
      return () => {
        widgetListener = null;
      };
    },
    requestStart,
    cancelStart,
    playback,
    auth,
  });

  return {
    consumePendingPlayRequest,
    abandonPlayRequest,
    cancelStart,
    requestStart,
    playback,
    auth,
    emit: (type: string) => widgetListener?.({ type }),
  };
};

describe("widget playback requests", () => {
  it("starts the remembered book for a request stored before JS launched", async () => {
    const { requestStart } = setup();
    await flush();

    expect(requestStart).toHaveBeenCalledWith("book-1");
  });

  it("waits for auth hydration before starting", async () => {
    const { requestStart, auth } = setup({ authStatus: "hydrating" });
    await flush();
    expect(requestStart).not.toHaveBeenCalled();

    auth.setState({ status: "authenticated" });
    await flush();
    expect(requestStart).toHaveBeenCalledTimes(1);
  });

  it("consumes a request delivered while JS is running", async () => {
    const { consumePendingPlayRequest, requestStart, emit } = setup({ hasPending: false });
    await flush();
    expect(requestStart).not.toHaveBeenCalled();

    consumePendingPlayRequest.mockResolvedValueOnce(true);
    emit("PLAY_REQUEST");
    await flush();
    expect(requestStart).toHaveBeenCalledWith("book-1");
  });

  it("abandons the request without a remembered audiobook", async () => {
    const noBook = setup({ libraryItemId: null });
    const episode = setup({ episodeId: "episode-1" });
    await flush();

    expect(noBook.requestStart).not.toHaveBeenCalled();
    expect(episode.requestStart).not.toHaveBeenCalled();
    expect(noBook.abandonPlayRequest).toHaveBeenCalledTimes(1);
    expect(episode.abandonPlayRequest).toHaveBeenCalledTimes(1);
  });

  it("does not abandon a request that started the book", async () => {
    const { abandonPlayRequest } = setup();
    await flush();
    await flush();

    expect(abandonPlayRequest).not.toHaveBeenCalled();
  });

  it("abandons the request when the start throws or the load fails", async () => {
    const thrown = setup();
    thrown.requestStart.mockReset().mockRejectedValue(new Error("offline"));
    const failed = setup();
    failed.requestStart.mockReset().mockImplementation(async () => {
      failed.playback.setState({ libraryItemId: "book-1", episodeId: null, playbackState: "error" });
      return { status: "accepted", intentId: "intent-2" };
    });
    await flush();
    await flush();

    expect(thrown.abandonPlayRequest).toHaveBeenCalledTimes(1);
    expect(failed.abandonPlayRequest).toHaveBeenCalledTimes(1);
  });

  it("cancels a start native timed out and does not treat it as started", async () => {
    const { requestStart, cancelStart, abandonPlayRequest, emit } = setup();
    let finishStart: (value: unknown) => void = () => {};
    requestStart.mockReset().mockReturnValue(new Promise((resolve) => (finishStart = resolve)));
    await flush();

    emit("PLAY_TIMEOUT");
    expect(cancelStart).toHaveBeenCalledTimes(1);

    finishStart({ status: "accepted", intentId: "intent-2" });
    await flush();
    expect(abandonPlayRequest).toHaveBeenCalledTimes(1);
  });

  it("drops a request still waiting for auth when native times out", async () => {
    const { requestStart, cancelStart, auth, emit } = setup({ authStatus: "hydrating" });
    await flush();

    emit("PLAY_TIMEOUT");
    auth.setState({ status: "authenticated" });
    await flush();

    expect(requestStart).not.toHaveBeenCalled();
    expect(cancelStart).not.toHaveBeenCalled();
  });
});
