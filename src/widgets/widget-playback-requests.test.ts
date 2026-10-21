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
  const playback = createStore({ libraryItemId, episodeId });
  const auth = createStore({ status: authStatus });

  startWidgetPlaybackRequests({
    consumePendingPlayRequest,
    addWidgetEventListener: (listener) => {
      widgetListener = listener;
      return () => {
        widgetListener = null;
      };
    },
    requestStart,
    playback,
    auth,
  });

  return {
    consumePendingPlayRequest,
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

  it("does nothing without a remembered audiobook", async () => {
    const noBook = setup({ libraryItemId: null });
    const episode = setup({ episodeId: "episode-1" });
    await flush();

    expect(noBook.requestStart).not.toHaveBeenCalled();
    expect(episode.requestStart).not.toHaveBeenCalled();
  });

  it("retries an ignored start on the next store update", async () => {
    const { requestStart, playback } = setup();
    requestStart.mockReset();
    requestStart
      .mockResolvedValueOnce({ status: "ignored", reason: "intent_active", activeIntentKind: "start" })
      .mockResolvedValue({ status: "accepted", intentId: "intent-2" });
    await flush();
    await flush();

    playback.setState({ libraryItemId: "book-1", episodeId: null });
    await flush();
    expect(requestStart).toHaveBeenCalledTimes(2);
  });
});
