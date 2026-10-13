import type { UserBookProgress } from "@/api/me-api";
import { sqliteHomeRepository } from "@/data/sqlite/home-repository";
import { resolveLocalBookProgress } from "./local-continue-listening";
import { nativeListeningPosition } from "./native-listening-position";

export type LocalDownloadOwner = { libraryItemId: string; ownerId: string | null };

/** Progress for owned downloads in the signed-out modes, keyed by libraryItemId. */
export const loadLocalDownloadProgress = async (
  owners: LocalDownloadOwner[],
  durationSecondsById: Record<string, number>,
): Promise<Record<string, UserBookProgress>> => {
  const idsByOwner = new Map<string, string[]>();
  for (const { libraryItemId, ownerId } of owners) {
    if (!ownerId) continue;
    idsByOwner.set(ownerId, [...(idsByOwner.get(ownerId) ?? []), libraryItemId]);
  }
  const storedById = await sqliteHomeRepository.getOwnerProgressByIds(
    Array.from(idsByOwner, ([userId, libraryItemIds]) => ({ userId, libraryItemIds })),
  );
  const canReadNative = nativeListeningPosition.capability() === "native";

  const progressById: Record<string, UserBookProgress> = {};
  await Promise.all(
    owners.map(async ({ libraryItemId, ownerId }) => {
      if (!ownerId) return;
      const native = canReadNative
        ? await nativeListeningPosition
            .get({ ownerId, libraryItemId, episodeId: null })
            .catch(() => null)
        : null;
      const progress = resolveLocalBookProgress({
        libraryItemId,
        durationSeconds: durationSecondsById[libraryItemId] ?? 0,
        stored: storedById[libraryItemId] ?? null,
        native,
      });
      if (progress) progressById[libraryItemId] = progress;
    }),
  );
  return progressById;
};
