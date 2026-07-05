import type { UserBookProgress } from "../api/me-api";
import type { HomeShelf } from "../hooks/use-home-shelves";
import type { BookProgressTimeDisplay } from "../store/settings-store";
import type { CarPlayResumeRecord } from "./carplay-resume-snapshot";

export type CarPlayBookPayload = {
	id: string;
	title: string;
	author?: string | null;
	detail?: string;
	/** Time read/left line rendered under the cover in shelf image rows (iOS 26). */
	subtitle?: string;
	coverUrl?: string;
	isPlaying?: boolean;
};

export type CarPlayShelfPayload = {
	id: string;
	title: string;
	books: CarPlayBookPayload[];
};

// Same "Xh YYm" format as the phone's shelf cards (shelf-book-card.tsx).
export const formatCarPlayDurationBadge = (durationSeconds: number): string => {
	const seconds = Math.max(0, Math.floor(durationSeconds));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
	return `${minutes}m`;
};

/**
 * Time line for a book, honoring the phone's progress-time setting
 * (Settings > Playback): "elapsed" -> time read ("10h 26m"), "remaining" ->
 * time left ("10h 26m left"). Mirrors shelf-book-card.tsx: no label until the
 * book has progress; finished books show the full duration when elapsed.
 */
export const formatCarPlayTimeLabel = (
	currentTimeSeconds: number,
	rawDurationSeconds: number,
	isFinished: boolean,
	display: BookProgressTimeDisplay,
): string | null => {
	const durationSeconds = Math.max(0, Math.floor(rawDurationSeconds || 0));
	const rawProgressSeconds = Math.max(0, Math.floor(currentTimeSeconds));
	const progressSeconds =
		durationSeconds > 0 ? Math.min(rawProgressSeconds, durationSeconds) : rawProgressSeconds;
	if (progressSeconds <= 0 && !isFinished) return null;

	if (display === "elapsed" || durationSeconds <= 0) {
		return formatCarPlayDurationBadge(isFinished ? durationSeconds : progressSeconds);
	}
	return `${formatCarPlayDurationBadge(Math.max(durationSeconds - progressSeconds, 0))} left`;
};

export const formatCarPlayBookTimeLabel = (
	progress: UserBookProgress | undefined,
	fallbackDurationSeconds: number,
	display: BookProgressTimeDisplay,
): string | null =>
	formatCarPlayTimeLabel(
		progress?.currentTime ?? 0,
		progress?.duration || fallbackDurationSeconds || 0,
		Boolean(progress?.isFinished),
		display,
	);

export const normalizeCarPlayCoverUrl = (
	cover: string | null | undefined,
): string | undefined => {
	if (!cover) return undefined;
	if (cover.startsWith("http://") || cover.startsWith("https://") || cover.startsWith("file://")) {
		return cover;
	}
	if (cover.startsWith("/")) return `file://${cover}`;
	return undefined;
};

const formatCarPlayBookDetail = (author: string | null | undefined, timeLabel: string | null) =>
	[author, timeLabel].filter(Boolean).join(" · ") || undefined;

/**
 * Convert the home hook's visible shelves into the compact native payload:
 * drop Discover (a browsing shelf, not a driving one), drop empty shelves,
 * pin Continue Listening first, keep phone ordering otherwise.
 */
export const buildCarPlayShelves = (
	visibleShelves: HomeShelf[],
	progressByBookId: Record<string, UserBookProgress>,
	display: BookProgressTimeDisplay,
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
			const timeLabel = formatCarPlayBookTimeLabel(progress, book.duration, display);
			return {
				id: book.id,
				title: book.title,
				author: book.author,
				detail: formatCarPlayBookDetail(book.author, timeLabel),
				subtitle: timeLabel ?? undefined,
				coverUrl: normalizeCarPlayCoverUrl(book.cover),
			};
		}),
	}));
};

export const overlayCarPlayShelfProgress = (
	shelves: CarPlayShelfPayload[],
	resumeRecords: Record<string, CarPlayResumeRecord>,
	display: BookProgressTimeDisplay,
): CarPlayShelfPayload[] => {
	let didChange = false;
	const nextShelves = shelves.map((shelf) => {
		let didChangeShelf = false;
		const nextBooks = shelf.books.map((book) => {
			const record = resumeRecords[book.id];
			if (!record) return book;

			const timeLabel = formatCarPlayTimeLabel(
				record.currentTimeSeconds,
				record.durationSeconds,
				record.isFinished,
				display,
			);
			const subtitle = timeLabel ?? undefined;
			const detail =
				"author" in book
					? formatCarPlayBookDetail(book.author, timeLabel)
					: book.detail;

			if (book.subtitle === subtitle && book.detail === detail) {
				return book;
			}

			didChange = true;
			didChangeShelf = true;
			return {
				...book,
				detail,
				subtitle,
			};
		});

		return didChangeShelf ? { ...shelf, books: nextBooks } : shelf;
	});

	return didChange ? nextShelves : shelves;
};
