import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { UserBookProgress } from "../api/me-api";
import type { HomeShelf } from "../hooks/use-home-shelves";
import { playbackStore } from "../player/playback-store";
import { playerService } from "../player/player-service";
import { deviceBooksStore } from "../store/device-books-store";
import { toDownloadedBookSummary } from "../store/downloaded-book-helpers";
import { mmkvStorage } from "../store/mmkv-storage";

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

// Same range the phone's rate screen offers (0.75–4.0, see player-rate.tsx).
const RATE_PRESETS = [0.75, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0];

const CARPLAY_EVENT_NAME = "AudioProCarPlayEvent";
const SNAPSHOT_KEY = "carplay-shelves-snapshot-v1";

let initialized = false;
let isConnected = false;
let shelves: CarPlayShelfPayload[] = [];
let lastPushedShelvesJson = "";
let lastPushedChaptersJson = "";

const log = (...args: unknown[]) => {
	if (__DEV__) console.log("[CarPlay]", ...args);
};

////////////////////////////////////////////////////////////
// Payload building
////////////////////////////////////////////////////////////

const formatTimeLeft = (secondsLeft: number): string | null => {
	if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return null;
	const totalMinutes = Math.round(secondsLeft / 60);
	if (totalMinutes < 1) return "<1m left";
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours <= 0) return `${minutes}m left`;
	return `${hours}h ${minutes}m left`;
};

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
			const timeLeft =
				progress && !progress.isFinished && progress.currentTime > 0
					? formatTimeLeft((progress.duration || book.duration) - progress.currentTime)
					: null;
			const detail = [book.author, timeLeft].filter(Boolean).join(" · ");
			return {
				id: book.id,
				title: book.title,
				detail: detail || undefined,
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
	const currentRate = playbackStore.getState().rate;
	// Include a non-preset custom rate (set via the phone slider) as its own row.
	const values = RATE_PRESETS.some((preset) => Math.abs(preset - currentRate) < 0.01)
		? RATE_PRESETS
		: [...RATE_PRESETS, currentRate].sort((a, b) => a - b);
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

export const publishCarPlayShelves = (
	visibleShelves: HomeShelf[],
	progressByBookId: Record<string, UserBookProgress>,
) => {
	if (Platform.OS !== "ios") return;
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
	const books = Object.values(downloadedDetailsById)
		.map((details) => {
			const summary = toDownloadedBookSummary(details);
			return {
				id: summary.id,
				title: summary.title ?? "Untitled",
				detail: summary.author ?? undefined,
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
const SELECTION_RETRY_MS = 700;
const SELECTION_MAX_ATTEMPTS = 10;

const handleItemSelected = (itemId: string) => {
	log("book selected", itemId);
	pendingSelectionId = itemId;
	void runPendingSelection(itemId, 0);
};

const runPendingSelection = async (itemId: string, attempt: number) => {
	if (pendingSelectionId !== itemId) return; // superseded by a newer tap
	try {
		const result = await playerService.requestStart(itemId);
		log("requestStart result", result.status, `attempt ${attempt}`);
		if (result.status === "ignored") {
			if (attempt < SELECTION_MAX_ATTEMPTS) {
				setTimeout(() => {
					if (pendingSelectionId) void runPendingSelection(pendingSelectionId, attempt + 1);
				}, SELECTION_RETRY_MS);
			} else {
				pendingSelectionId = null;
				NativeModules.AudioPro?.carPlayShowAlert?.("Couldn't start this book");
			}
			return;
		}
		pendingSelectionId = null;
		if (result.status !== "accepted" && result.status !== "already_satisfied") {
			NativeModules.AudioPro?.carPlayShowAlert?.("Couldn't start this book");
		}
	} catch (error) {
		log("requestStart failed", error);
		pendingSelectionId = null;
		NativeModules.AudioPro?.carPlayShowAlert?.(
			"Couldn't start this book — check your connection",
		);
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

	snapshotReady = loadSnapshot().then(() => {
		// Cover the not-yet-connected boot too: hand native the restored
		// shelves so the template is ready the instant the scene connects.
		pushShelvesToNative();
	});
	log("service initialized");
};
