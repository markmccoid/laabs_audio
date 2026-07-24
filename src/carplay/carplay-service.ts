import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { UserBookProgress } from "../api/me-api";
import { authStore } from "../auth/auth-store";
import type { HomeShelf } from "../hooks/use-home-shelves";
import { playbackStore } from "../player/playback-store";
import { playerService } from "../player/player-service";
import {
	deviceBooksStore,
	selectHasPlayableBookDownload,
	toHomeShelfScopeKey,
} from "../store/device-books-store";
import { toDownloadedBookSummary } from "../store/downloaded-book-helpers";
import { mmkvStorage } from "../store/mmkv-storage";
import {
	clampPlaybackRateToRange,
	selectHomeShelfSettings,
	settingsStore,
} from "../store/settings-store";
import {
	getCarPlayResumeSnapshotMap,
	recordCarPlayProgressSnapshotMap,
	recordCarPlayResumeSnapshot,
	type CarPlayResumeRecord,
} from "./carplay-resume-snapshot";
import { buildCarPlayRateOptions } from "./carplay-rate-options";
import {
	buildCarPlayShelves,
	formatCarPlayTimeLabel,
	normalizeCarPlayCoverUrl,
	overlayCarPlayShelfProgress,
	promoteCarPlayContinueListeningBook,
	type CarPlayShelfPayload,
} from "./carplay-shelf-labels";

/**
 * CarPlay bridge — see docs/carplay-integration-plan.md.
 *
 * Layout (decided 2026-07-02): root = shelf rows (CPListImageRowItem: shelf
 * title + up to 8 tappable covers + chevron into the full list), mirroring the
 * iPhone home shelves minus Discover with Continue Listening pinned first.
 * Tapping a book plays immediately and shows Now Playing; its Up Next button
 * ("Chapters") lists chapters.
 *
 * Data flow: CarPlayShelfPublisher (mounted in _layout) feeds useHomeShelves()
 * output here whenever the phone UI runs. Each publish is persisted as an MMKV
 * snapshot so a car-initiated cold launch (headless — React never mounts) can
 * render the last-known shelves instantly. Playing state and chapters come
 * from playbackStore, which works headless.
 *
 * Talks to NativeModules.AudioPro directly (not the module's JS wrapper) so
 * the CarPlay surface stays isolated from the audio API.
 */

type CarPlayEvent = {
	type: "CONNECTED" | "DISCONNECTED" | "ITEM_SELECTED" | "CHAPTER_SELECTED" | "RATE_SELECTED";
	itemId?: string;
	chapterId?: number;
	rate?: number;
};

const CARPLAY_EVENT_NAME = "AudioProCarPlayEvent";
const SNAPSHOT_KEY = "carplay-shelves-snapshot-v1";
// Logged at init so a device capture proves WHICH build is running — a stale
// install burned a whole hardware test session on 2026-07-03. Bump on every
// CarPlay-affecting change.
const CARPLAY_SERVICE_BUILD = "attempt-o-20260722";

let initialized = false;
let isConnected = false;
let shelves: CarPlayShelfPayload[] = [];
let lastPushedShelvesJson = "";
let lastPushedChaptersJson = "";

const log = (...args: unknown[]) => {
	console.log("[CarPlay]", ...args);
	// Mirror into the device syslog via native NSLog: console.log never
	// reaches the phone's log in Release builds, which left hardware tests
	// blind on the JS side. Visible in Console.app / idevicesyslog as
	// "[CarPlay][JS] …".
	try {
		const message = args
			.map((value) => {
				if (typeof value === "string") return value;
				if (value instanceof Error) return value.message;
				try {
					return JSON.stringify(value);
				} catch {
					return String(value);
				}
			})
			.join(" ");
		NativeModules.AudioPro?.carPlayLog?.(message);
	} catch {
		// Logging must never break the CarPlay flow.
	}
};

////////////////////////////////////////////////////////////
// Payload building
////////////////////////////////////////////////////////////

const getProgressTimeDisplay = () => settingsStore.getState().defaultBookProgressTimeDisplay;

////////////////////////////////////////////////////////////
// Native pushes
////////////////////////////////////////////////////////////

const stampPlayingFlags = (payload: CarPlayShelfPayload[]): CarPlayShelfPayload[] => {
	const playingId = playbackStore.getState().libraryItemId;
	if (!playingId) return payload;
	return payload.map((shelf) => ({
		...shelf,
		books: shelf.books.map((book) =>
			book.id === playingId ? { ...book, isPlaying: true } : book,
		),
	}));
};

const pushShelvesToNative = () => {
	const stamped = stampPlayingFlags(shelves);
	const json = JSON.stringify(stamped);
	if (json === lastPushedShelvesJson) return;
	lastPushedShelvesJson = json;
	log("pushing", stamped.length, "shelves to CarPlay");
	NativeModules.AudioPro?.carPlaySetShelves?.(stamped);
};

let lastPushedRatesJson = "";

const pushRatesToNative = () => {
	const { playbackRateRangeMin, playbackRateRangeMax } = settingsStore.getState();
	const currentRate = clampPlaybackRateToRange(playbackStore.getState().rate, {
		min: playbackRateRangeMin,
		max: playbackRateRangeMax,
	});
	const rates = buildCarPlayRateOptions({
		currentRate,
		minimumRate: playbackRateRangeMin,
		maximumRate: playbackRateRangeMax,
	});
	const json = JSON.stringify(rates);
	if (json === lastPushedRatesJson) return;
	lastPushedRatesJson = json;
	NativeModules.AudioPro?.carPlaySetRates?.(rates);
};

const pushChaptersToNative = () => {
	const { chapterIndex, currentChapterId } = playbackStore.getState();
	const chapters = chapterIndex.map((chapter) => ({
		id: chapter.id,
		title: chapter.title ?? `Chapter ${chapter.id}`,
		isCurrent: chapter.id === currentChapterId,
	}));
	const json = JSON.stringify(chapters);
	if (json === lastPushedChaptersJson) return;
	lastPushedChaptersJson = json;
	NativeModules.AudioPro?.carPlaySetChapters?.(chapters);
};

////////////////////////////////////////////////////////////
// Publishing (from the React-side CarPlayShelfPublisher)
////////////////////////////////////////////////////////////

// Kept so a progress-time-display setting change can rebuild the shelf labels
// without waiting for the next publish from the phone UI.
let lastPublishInputs: {
	visibleShelves: HomeShelf[];
	progressByBookId: Record<string, UserBookProgress>;
} | null = null;

const persistShelvesSnapshot = () => {
	void Promise.resolve(mmkvStorage.setItem(SNAPSHOT_KEY, JSON.stringify(shelves))).catch(
		() => {},
	);
};

const getContinueListeningShelfSettings = () => {
	const { activeLibraryUserKey, activeLibraryId } = authStore.getState();
	const scopeKey = toHomeShelfScopeKey(activeLibraryUserKey, activeLibraryId);
	return selectHomeShelfSettings(settingsStore.getState(), scopeKey, "continueListening");
};

const promoteActivePlaybackInContinueListening = (
	state: ReturnType<typeof playbackStore.getState>,
	resumeRecord: CarPlayResumeRecord,
) => {
	if (!state.libraryItemId) return false;
	const currentTrack = state.queue[state.currentTrackIndex] ?? state.queue[0];
	const shelfSettings = getContinueListeningShelfSettings();
	const nextShelves = promoteCarPlayContinueListeningBook(
		shelves,
		{
			id: state.libraryItemId,
			title: state.bookTitle ?? currentTrack?.title ?? "Untitled",
			author: currentTrack?.author,
			coverUrl: currentTrack?.artworkUri,
			currentTimeSeconds: resumeRecord.currentTimeSeconds,
			durationSeconds: resumeRecord.durationSeconds,
			isFinished: resumeRecord.isFinished,
		},
		getProgressTimeDisplay(),
		{
			isVisible: shelfSettings.isVisible,
			maxBooks: shelfSettings.homeItemCount,
		},
	);
	if (nextShelves === shelves) return false;
	shelves = nextShelves;
	persistShelvesSnapshot();
	return true;
};

const refreshShelfProgressLabels = (
	resumeRecords: ReturnType<typeof getCarPlayResumeSnapshotMap>,
) => {
	if (shelves.length === 0) return false;
	const nextShelves = overlayCarPlayShelfProgress(
		shelves,
		resumeRecords,
		getProgressTimeDisplay(),
	);
	if (nextShelves === shelves) return false;
	shelves = nextShelves;
	persistShelvesSnapshot();
	return true;
};

export const publishCarPlayShelves = (
	visibleShelves: HomeShelf[],
	progressByBookId: Record<string, UserBookProgress>,
) => {
	if (Platform.OS !== "ios") return;
	lastPublishInputs = { visibleShelves, progressByBookId };
	recordCarPlayProgressSnapshotMap(progressByBookId);
	shelves = buildCarPlayShelves(
		visibleShelves,
		progressByBookId,
		getProgressTimeDisplay(),
	);
	refreshShelfProgressLabels(getCarPlayResumeSnapshotMap());
	persistShelvesSnapshot();
	pushShelvesToNative();
};

/**
 * First-ever cold boot (no snapshot yet): build a minimal Downloaded shelf
 * straight from the device store — it hydrates synchronously from MMKV, so
 * this works headless and offline.
 */
const buildDownloadedFallbackShelf = (): CarPlayShelfPayload[] => {
	const { downloadedDetailsById } = deviceBooksStore.getState();
	const resumeRecords = getCarPlayResumeSnapshotMap();
	const books = Object.values(downloadedDetailsById)
		.map((details) => {
			const summary = toDownloadedBookSummary(details);
			const record = resumeRecords[summary.id];
			const timeLabel = record
				? formatCarPlayTimeLabel(
						record.currentTimeSeconds,
						record.durationSeconds,
						record.isFinished,
						getProgressTimeDisplay(),
					)
				: null;
			return {
				id: summary.id,
				title: summary.title ?? "Untitled",
				author: summary.author,
				detail: [summary.author, timeLabel].filter(Boolean).join(" · ") || undefined,
				subtitle: timeLabel ?? undefined,
				coverUrl: normalizeCarPlayCoverUrl(summary.cover),
			};
		})
		.sort((a, b) => a.title.localeCompare(b.title));
	if (books.length === 0) return [];
	return [{ id: "downloaded", title: "Downloaded", books }];
};

const loadSnapshot = async () => {
	try {
		const raw = await Promise.resolve(mmkvStorage.getItem(SNAPSHOT_KEY));
		const parsed = raw ? (JSON.parse(raw) as CarPlayShelfPayload[]) : null;
		// A live publish may have happened while the snapshot read was pending.
		if (shelves.length === 0 && Array.isArray(parsed) && parsed.length > 0) {
			shelves = parsed;
			log("restored", parsed.length, "shelves from snapshot");
		}
	} catch (error) {
		log("snapshot restore failed", error);
	}
	if (shelves.length === 0) {
		shelves = buildDownloadedFallbackShelf();
		if (shelves.length > 0) log("using downloaded-books fallback shelf");
	}
	refreshShelfProgressLabels(getCarPlayResumeSnapshotMap());
};

// Pushes triggered by connect events await this so an early, still-empty
// state never reaches the car as a wrong "No books yet".
let snapshotReady: Promise<void> | null = null;

const pushAfterSnapshot = () => {
	void (snapshotReady ?? Promise.resolve()).then(() => {
		lastPushedShelvesJson = "";
		lastPushedChaptersJson = "";
		lastPushedRatesJson = "";
		pushShelvesToNative();
		pushChaptersToNative();
		pushRatesToNative();
	});
};

////////////////////////////////////////////////////////////
// Event handling
////////////////////////////////////////////////////////////

// requestStart is gated by playerService's playback-control intent: while a
// prior action is settling — including the FULL load of a previously selected
// book (seconds, when streaming) — it returns {status:"ignored"}. In the car
// that must not dead-end: remember the latest selection and retry until the
// gate clears. A newer tap supersedes an older pending one.
let pendingSelectionId: string | null = null;
let pendingSelectionAttempt = 0;
let pendingSelectionBusy = false;
let lastSelectionAttemptAt = 0;
const SELECTION_RETRY_MS = 700;
// A competing start can legitimately hold the playback-control intent for up
// to the 20s streamed-start timeout; the retry window must outlast it (and the
// player-service stale-intent recovery at ~22s) or a tap made while another
// book is still starting dead-ends into an alert. 40 × 700ms ≈ 28s.
const SELECTION_MAX_ATTEMPTS = 40;
const RESUME_SNAPSHOT_WRITE_INTERVAL_MS = 10_000;
let lastResumeSnapshotWriteAt = 0;

const handleItemSelected = (itemId: string) => {
	log("book selected", itemId);
	// A fresh tap supersedes any pending selection and restarts its budget.
	pendingSelectionId = itemId;
	pendingSelectionAttempt = 0;
	void runPendingSelection(itemId);
};

// Timer-free retry driver. setTimeout does NOT fire in a headless/background
// CarPlay launch (verified on hardware 2026-07-03), so retries are also driven
// by playbackStore updates — native progress events tick the store at ~1 Hz
// while audio plays, giving an event-driven clock. Called from the store
// subscription in initCarPlayService.
const maybeRetryPendingSelection = () => {
	if (!pendingSelectionId || pendingSelectionBusy) return;
	if (Date.now() - lastSelectionAttemptAt < SELECTION_RETRY_MS) return;
	void runPendingSelection(pendingSelectionId);
};

const isDownloadedBook = (itemId: string) =>
	selectHasPlayableBookDownload(deviceBooksStore.getState(), itemId);

const showStartFailureAlert = (itemId: string) => {
	const message = isDownloadedBook(itemId)
		? "Couldn't start this book"
		: "Open LAABS on your phone to stream this book";
	NativeModules.AudioPro?.carPlayShowAlert?.(message);
};

const runPendingSelection = async (itemId: string) => {
	if (pendingSelectionId !== itemId) return; // superseded by a newer tap
	if (pendingSelectionBusy) return;
	pendingSelectionBusy = true;
	lastSelectionAttemptAt = Date.now();
	const attempt = pendingSelectionAttempt;
	try {
		const result = await playerService.requestStart(itemId);
		if (pendingSelectionId !== itemId) return; // superseded while awaiting
		log("requestStart result", result.status, `attempt ${attempt}`);
		if (result.status === "ignored") {
			pendingSelectionAttempt = attempt + 1;
			if (attempt < SELECTION_MAX_ATTEMPTS) {
				// Foreground path — in headless launches this timer never fires
				// and maybeRetryPendingSelection (store-tick driven) takes over.
				setTimeout(() => {
					maybeRetryPendingSelection();
				}, SELECTION_RETRY_MS);
			} else {
				log("selection retries exhausted", itemId);
				pendingSelectionId = null;
				showStartFailureAlert(itemId);
			}
			return;
		}
		pendingSelectionId = null;
		if (result.status !== "accepted" && result.status !== "already_satisfied") {
			showStartFailureAlert(itemId);
		}
	} catch (error) {
		log("requestStart failed", error);
		pendingSelectionId = null;
		showStartFailureAlert(itemId);
	} finally {
		pendingSelectionBusy = false;
	}
};

const handleChapterSelected = (chapterId: number) => {
	log("chapter selected", chapterId);
	void playerService.jumpToChapter(chapterId).catch((error) => {
		log("jumpToChapter failed", error);
	});
};

const handleRateSelected = (rate: number) => {
	log("rate selected", rate);
	void playerService.setRate(rate).catch((error) => {
		log("setRate failed", error);
	});
};

export const initCarPlayService = () => {
	if (initialized || Platform.OS !== "ios") return;
	const native = NativeModules.AudioPro;
	if (!native) {
		log("AudioPro native module unavailable; CarPlay service not started");
		return;
	}
	initialized = true;

	const emitter = new NativeEventEmitter(native);
	emitter.addListener(CARPLAY_EVENT_NAME, (event: CarPlayEvent) => {
		log("event", event.type);
		switch (event.type) {
			case "CONNECTED":
				isConnected = true;
				// Force a fresh push — the native side starts empty on connect.
				pushAfterSnapshot();
				break;
			case "DISCONNECTED":
				isConnected = false;
				break;
			case "ITEM_SELECTED":
				if (event.itemId) handleItemSelected(event.itemId);
				break;
			case "CHAPTER_SELECTED":
				if (typeof event.chapterId === "number") handleChapterSelected(event.chapterId);
				break;
			case "RATE_SELECTED":
				if (typeof event.rate === "number") handleRateSelected(event.rate);
				break;
		}
	});

	// Cold launch from the car: the scene connected before any JS listener
	// existed, so the CONNECTED event was never delivered — catch up here.
	native
		.carPlayGetStatus?.()
		.then((status: { connected?: boolean } | undefined) => {
			if (status?.connected) {
				log("CarPlay already connected at JS startup");
				isConnected = true;
				pushAfterSnapshot();
			}
		})
		.catch(() => {});

	// Keep playing indicators + chapters in sync with the player, headless or not.
	playbackStore.subscribe((state, prevState) => {
		// Headless retry clock: store updates tick at ~1 Hz during playback.
		maybeRetryPendingSelection();
		const now = Date.now();
		if (
			state.libraryItemId &&
			// A zero position carries no resume information and would clobber a
			// good snapshot: setSession zeroes positionMs before the resume seek.
			state.positionMs > 0 &&
			(state.positionMs !== prevState.positionMs ||
				state.durationMs !== prevState.durationMs ||
				state.libraryItemId !== prevState.libraryItemId) &&
			(state.libraryItemId !== prevState.libraryItemId ||
				now - lastResumeSnapshotWriteAt >= RESUME_SNAPSHOT_WRITE_INTERVAL_MS)
		) {
			lastResumeSnapshotWriteAt = now;
			const resumeRecord = {
				libraryItemId: state.libraryItemId,
				currentTimeSeconds: Math.floor(state.positionMs / 1000),
				durationSeconds: Math.floor(state.durationMs / 1000),
				isFinished:
					state.durationMs > 0 && state.positionMs >= state.durationMs - 3000,
				updatedAt: Date.now(),
			};
			recordCarPlayResumeSnapshot(resumeRecord);
			const didPromote = promoteActivePlaybackInContinueListening(state, resumeRecord);
			const didRefresh = refreshShelfProgressLabels({ [state.libraryItemId]: resumeRecord });
			if ((didPromote || didRefresh) && isConnected) {
				pushShelvesToNative();
			}
		}
		if (
			state.libraryItemId !== prevState.libraryItemId ||
			state.chapterIndex !== prevState.chapterIndex ||
			state.currentChapterId !== prevState.currentChapterId ||
			state.rate !== prevState.rate
		) {
			if (!isConnected) return;
			pushShelvesToNative();
			pushChaptersToNative();
			pushRatesToNative();
		}
	});

	// Rebuild shelf time labels when the user flips the progress-time-display
	// setting (elapsed vs remaining) so the CarPlay covers match the phone.
	settingsStore.subscribe((state, prevState) => {
		if (state.defaultBookProgressTimeDisplay !== prevState.defaultBookProgressTimeDisplay) {
			if (lastPublishInputs) {
				publishCarPlayShelves(
					lastPublishInputs.visibleShelves,
					lastPublishInputs.progressByBookId,
				);
			} else if (refreshShelfProgressLabels(getCarPlayResumeSnapshotMap())) {
				pushShelvesToNative();
			}
		}
		if (
			state.playbackRateRangeMin !== prevState.playbackRateRangeMin ||
			state.playbackRateRangeMax !== prevState.playbackRateRangeMax
		) {
			pushRatesToNative();
		}
	});

	snapshotReady = loadSnapshot().then(() => {
		// Cover the not-yet-connected boot too: hand native the restored
		// shelves so the template is ready the instant the scene connects.
		pushShelvesToNative();
	});
	log("service initialized", CARPLAY_SERVICE_BUILD);
};
