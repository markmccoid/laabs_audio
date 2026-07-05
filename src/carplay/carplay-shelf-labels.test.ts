import type { LibraryItemSummary } from "../api/library-items-api";
import {
	buildCarPlayShelves,
	overlayCarPlayShelfProgress,
	type CarPlayShelfPayload,
} from "./carplay-shelf-labels";

const makeProgress = (currentTime: number, duration: number) => ({
	progressId: "progress-book-1",
	libraryItemId: "book-1",
	duration,
	progressPercent: duration > 0 ? currentTime / duration : 0,
	currentTime,
	isFinished: false,
	hideFromContinueListening: false,
	startedAt: 1,
	finishedAt: null,
	lastUpdate: 1,
});

const makeBook = (): LibraryItemSummary => ({
	id: "book-1",
	title: "Book One",
	author: "Author One",
	duration: 36_000,
	addedAt: 1,
	updatedAt: 1,
	cover: "",
	coverFull: "",
	numAudioFiles: null,
	ebookFormat: null,
	genres: [],
	tags: [],
});

describe("CarPlay shelf labels", () => {
	it("builds shelf payloads with author metadata so headless progress can rebuild detail text", () => {
		const shelves = buildCarPlayShelves(
			[
				{
					kind: "derived",
					id: "continueListening",
					title: "Continue Listening",
					books: [makeBook()],
					homeItemCount: 10,
					isVisible: true,
					emptyMessage: "",
				},
			],
			{ "book-1": makeProgress(18_000, 36_000) },
			"remaining",
		);

		expect(shelves[0]?.books[0]).toMatchObject({
			author: "Author One",
			detail: "Author One · 5h 00m left",
			subtitle: "5h 00m left",
		});
	});

	it("overlays headless resume progress onto current shelf labels", () => {
		const shelves = buildCarPlayShelves(
			[
				{
					kind: "derived",
					id: "continueListening",
					title: "Continue Listening",
					books: [makeBook()],
					homeItemCount: 10,
					isVisible: true,
					emptyMessage: "",
				},
			],
			{ "book-1": makeProgress(18_000, 36_000) },
			"remaining",
		);

		const nextShelves = overlayCarPlayShelfProgress(
			shelves,
			{
				"book-1": {
					libraryItemId: "book-1",
					currentTimeSeconds: 21_600,
					durationSeconds: 36_000,
					isFinished: false,
					updatedAt: 2,
				},
			},
			"remaining",
		);

		expect(nextShelves).not.toBe(shelves);
		expect(nextShelves[0]?.books[0]).toMatchObject({
			detail: "Author One · 4h 00m left",
			subtitle: "4h 00m left",
		});
	});

	it("updates old persisted shelf snapshots without parsing stale detail strings", () => {
		const oldShelves: CarPlayShelfPayload[] = [
			{
				id: "continueListening",
				title: "Continue Listening",
				books: [
					{
						id: "book-1",
						title: "Book One",
						detail: "Author One · 5h 00m left",
						subtitle: "5h 00m left",
					},
				],
			},
		];

		const nextShelves = overlayCarPlayShelfProgress(
			oldShelves,
			{
				"book-1": {
					libraryItemId: "book-1",
					currentTimeSeconds: 21_600,
					durationSeconds: 36_000,
					isFinished: false,
					updatedAt: 2,
				},
			},
			"remaining",
		);

		expect(nextShelves[0]?.books[0]).toMatchObject({
			detail: "Author One · 5h 00m left",
			subtitle: "4h 00m left",
		});
	});
});
