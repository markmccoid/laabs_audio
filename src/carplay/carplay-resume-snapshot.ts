import type { UserBookProgress } from "../api/me-api";
import { mmkvStorage } from "../store/mmkv-storage";

const CARPLAY_RESUME_SNAPSHOT_KEY = "carplay-resume-snapshot-v1";

export type CarPlayResumeRecord = {
	libraryItemId: string;
	mediaItemId?: string | null;
	currentTimeSeconds: number;
	durationSeconds: number;
	isFinished: boolean;
	updatedAt: number;
};

type CarPlayResumeSnapshot = Record<string, CarPlayResumeRecord>;

const normalizeSeconds = (value: number | null | undefined) =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;

const mergeRecord = (
	snapshot: CarPlayResumeSnapshot,
	record: CarPlayResumeRecord,
) => {
	if (!record.libraryItemId) return;
	const previous = snapshot[record.libraryItemId];
	const currentTimeSeconds = normalizeSeconds(record.currentTimeSeconds);
	const durationSeconds = Math.max(
		normalizeSeconds(record.durationSeconds),
		normalizeSeconds(previous?.durationSeconds),
	);

	snapshot[record.libraryItemId] = {
		libraryItemId: record.libraryItemId,
		mediaItemId: record.mediaItemId ?? previous?.mediaItemId ?? null,
		currentTimeSeconds,
		durationSeconds,
		isFinished: record.isFinished,
		updatedAt: record.updatedAt,
	};
};

const readSnapshot = (): CarPlayResumeSnapshot => {
	try {
		const raw = mmkvStorage.getItem(CARPLAY_RESUME_SNAPSHOT_KEY);
		if (typeof raw !== "string" || raw.length === 0) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as CarPlayResumeSnapshot) : {};
	} catch {
		return {};
	}
};

const writeSnapshot = (snapshot: CarPlayResumeSnapshot) => {
	try {
		mmkvStorage.setItem(CARPLAY_RESUME_SNAPSHOT_KEY, JSON.stringify(snapshot));
	} catch {
		// Best effort: CarPlay resume should never block playback.
	}
};

export const recordCarPlayResumeSnapshot = (record: CarPlayResumeRecord) => {
	if (!record.libraryItemId) return;
	const snapshot = readSnapshot();
	mergeRecord(snapshot, record);
	writeSnapshot(snapshot);
};

export const recordCarPlayProgressSnapshot = (progress: UserBookProgress) => {
	if (!progress.libraryItemId || typeof progress.currentTime !== "number") return;
	recordCarPlayResumeSnapshot({
		libraryItemId: progress.libraryItemId,
		mediaItemId: progress.mediaItemId ?? null,
		currentTimeSeconds: progress.currentTime,
		durationSeconds: progress.duration ?? 0,
		isFinished: Boolean(progress.isFinished),
		updatedAt: Math.max(0, Math.floor(progress.lastUpdate ?? Date.now())),
	});
};

export const recordCarPlayProgressSnapshotMap = (
	progressByBookId: Record<string, UserBookProgress>,
) => {
	const snapshot = readSnapshot();
	Object.values(progressByBookId).forEach((progress) => {
		if (!progress.libraryItemId || typeof progress.currentTime !== "number") return;
		mergeRecord(snapshot, {
			libraryItemId: progress.libraryItemId,
			mediaItemId: progress.mediaItemId ?? null,
			currentTimeSeconds: progress.currentTime,
			durationSeconds: progress.duration ?? 0,
			isFinished: Boolean(progress.isFinished),
			updatedAt: Math.max(0, Math.floor(progress.lastUpdate ?? Date.now())),
		});
	});
	writeSnapshot(snapshot);
};

export const getCarPlayResumeSnapshotForCandidateIds = (candidateIds: string[]) => {
	if (!candidateIds.length) return null;
	const snapshot = readSnapshot();
	const direct = candidateIds
		.map((candidateId) => snapshot[candidateId])
		.find((record): record is CarPlayResumeRecord => Boolean(record));
	if (direct) return direct;

	return (
		Object.values(snapshot).reduce<CarPlayResumeRecord | null>((best, record) => {
			const matches =
				candidateIds.includes(record.libraryItemId) ||
				(typeof record.mediaItemId === "string" && candidateIds.includes(record.mediaItemId));
			if (!matches) return best;
			if (!best) return record;
			return record.updatedAt >= best.updatedAt ? record : best;
		}, null) ?? null
	);
};
