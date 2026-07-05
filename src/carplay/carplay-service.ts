import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { UserBookProgress } from "../api/me-api";
import type { HomeShelf } from "../hooks/use-home-shelves";
import { playbackStore } from "../player/playback-store";
import { playerService } from "../player/player-service";
import {
	deviceBooksStore,
	selectHasPlayableBookDownload,
} from "../store/device-books-store";
import { toDownloadedBookSummary } from "../store/downloaded-book-helpers";
import { mmkvStorage } from "../store/mmkv-storage";
import { clampPlaybackRateToRange, settingsStore } from "../store/settings-store";
import {
	getCarPlayResumeSnapshotMap,
	recordCarPlayProgressSnapshotMap,
	recordCarPlayResumeSnapshot,
} from "./carplay-resume-snapshot";

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

type CarPlayBookPayload = {
	id: string;
	title: string;
	detail?: string;
	/** Time read/left line rendered under the cover in shelf image rows (iOS 26). */
	subtitle?: string;
	coverUrl?: string;
	isPlaying?: boolean;
};

type CarPlayShelfPayload = {
	id: string;
	title: string;
	books: CarPlayBookPayload[];
};

type CarPlayEvent = {
	type: "CONNECTED" | "DISCONNECTED" | "ITEM_SELECTED" | "CHAPTER_SELECTED" | "RATE_SELECTED";
	itemId?: string;
	chapterId?: number;
	rate?: number;
};

// Same presets the phone's rate surfaces offer, filtered by Playback Rate Range.
const RATE_PRESETS = [0.75, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0];

const CARPLAY_EVENT_NAME = "AudioProCarPlayEvent";
const SNAPSHOT_KEY = "carplay-shelves-snapshot-v1";
// Logged at init so a device capture proves WHICH build is running — a stale
// install burned a whole hardware test session on 2026-07-03. Bump on every
// CarPlay-affecting change.
const CARPLAY_SERVICE_BUILD = "attempt-h-20260704";

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

// Same "Xh YYm" format as the phone's shelf cards (shelf-book-card.tsx).
const formatDurationBadge = (durationSeconds: number): string => {
	const seconds = Math.max(0, Math.floor(durationSeconds));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
	return `${minutes}m`;
};

/**
 * Time line for a book, honoring the phone's progress-time setting
 * (Settings > Playback): "elapsed" → time read ("10h 26m"), "remaining" →
 * time left ("10h 26m left"). Mirrors shelf-book-card.tsx: no label until the
 * book has progress; finished books show the full duration when elapsed.
 */
const formatTimeLabelParts = (
	currentTimeSeconds: number,
	rawDurationSeconds: number,
	isFinished: boolean,
): string | null => {
	const durationSeconds = Math.max(0, Math.floor(rawDurationSeconds || 0));
	const rawProgressSeconds = Math.max(0, Math.floor(currentTimeSeconds));
	const progressSeconds =
		durationSeconds > 0 ? Math.min(rawProgressSeconds, durationSeconds) : rawProgressSeconds;
	if (progressSeconds <= 0 && !isFinished) return null;

	const display = settingsStore.getState().defaultBookProgressTimeDisplay;
	if (display === "elapsed" || durationSeconds <= 0) {
		return formatDurationBadge(isFinished ? durationSeconds : progressSeconds);
	}
	return `${formatDurationBadge(Math.max(durationSeconds - progressSeconds, 0))} left`;
};

const formatBookTimeLabel = (
	progress: UserBookProgress | undefined,
	fallbackDurationSeconds: number,
): string | null =>
	formatTimeLabelParts(
		progress?.currentTime ?? 0,
		progress?.duration || fallbackDurationSeconds || 0,
		Boolean(progress?.isFinished),
	);

const normalizeCoverUrl = (cover: string | null | undefined): string | undefined => {
	if (!cover) return undefined;
	if (cover.startsWith("http://") || cover.startsWith("https://") || cover.startsWith("file://")) {
		return cover;
	}
	if (cover.startsWith("/")) return `file://${cover}`;
	return undefined;
};

/**
 * Convert the home hook's visible shelves into the compact native payload:
 * drop Discover (a browsing shelf, not a driving one), drop empty shelves,
 * pin Continue Listening first, keep phone ordering otherwise.
 */
export const buildCarPlayShelves = (
	visibleShelves: HomeShelf[],
	progressByBookId: Record<string, UserBookProgress>,
): CarPlayShelfPayload[] => {
	const eligible = visibleShelves.filter(
		(shelf) => shelf.id !== "discover" && shelf.books.length > 0,
	);
	const pinned = [
		...eligible.filter((shelf) => shelf.id === "continueListening"),
		...eligible.filter((shelf) => shelf.id !== "continueListening"),
	];
	return pinned.map((shelf) => ({
		id: shelf.id,
		title: shelf.title,
		books: shelf.books.map((book) => {
			const progress = progressByBookId[book.id];
			const timeLabel = formatBookTimeLabel(progress, book.duration);
			const detail = [book.author, timeLabel].filter(Boolean).join(" · ");
			return {
				id: book.id,
				title: book.title,
				detail: detail || undefined,
				subtitle: timeLabel ?? undefined,
				coverUrl: normalizeCoverUrl(book.cover),
			};
		}),
	}));
};

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
	const presetValues = RATE_PRESETS.filter(
		(preset) => preset >= playbackRateRangeMin && preset <= playbackRateRangeMax,
	);
	// Include a non-preset custom rate (set via the phone slider) as its own row.
	const values = presetValues.some((preset) => Math.abs(preset - currentRate) < 0.01)
		? presetValues
		: [...presetValues, currentRate].sort((a, b) => a - b);
	const rates = values.map((value) => ({
		value,
		label: `${Number(value.toFixed(2))}×`,
		isCurrent: Math.abs(value - currentRate) < 0.01,
	}));
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

export const publishCarPlayShelves = (
	visibleShelves: HomeShelf[],
	progressByBookId: Record<string, UserBookProgress>,
) => {
	if (Platform.OS !== "ios") return;
	lastPublishInputs = { visibleShelves, progressByBookId };
	recordCarPlayProgressSnapshotMap(progressByBookId);
	shelves = buildCarPlayShelves(visibleShelves, progressByBookId);
	void Promise.resolve(mmkvStorage.setItem(SNAPSHOT_KEY, JSON.stringify(shelves))).catch(
		() => {},
	);
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
				? formatTimeLabelParts(
						record.currentTimeSeconds,
						record.durationSeconds,
						record.isFinished,
					)
				: null;
			return {
				id: summary.id,
				title: summary.title ?? "Untitled",
				detail: [summary.author, timeLabel].filter(Boolean).join(" · ") || undefined,
				subtitle: timeLabel ?? undefined,
				coverUrl: normalizeCoverUrl(summary.cover),
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
			recordCarPlayResumeSnapshot({
				libraryItemId: state.libraryItemId,
				currentTimeSeconds: Math.floor(state.positionMs / 1000),
				durationSeconds: Math.floor(state.durationMs / 1000),
				isFinished:
					state.durationMs > 0 && state.positionMs >= state.durationMs - 3000,
				updatedAt: Date.now(),
			});
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
