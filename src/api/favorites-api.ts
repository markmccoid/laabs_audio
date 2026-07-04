import { authStore } from "../auth/auth-store";
import type { LibraryItem } from "../types/absTypes";

export type FavoriteInfo = {
  favoriteSearchString: string;
  favoriteUserTagValue: string;
};

const normalizeTags = (tags?: string[] | null) => tags?.filter(Boolean) ?? [];

export const favoritesApi = {
  /** Non-throwing tag builder for callers that can render before auth hydrates. */
  buildFavoriteTagValue(username: string | null | undefined): string | null {
    return username ? `${username}-laab-favorite` : null;
  },

  getUserFavoriteInfo(): FavoriteInfo {
    const { storedUsername } = authStore.getState();
    const favoriteUserTagValue = favoritesApi.buildFavoriteTagValue(storedUsername);

    if (!favoriteUserTagValue) {
      throw new Error("Missing username for favorite tagging");
    }

    const favoriteSearchString = btoa(favoriteUserTagValue);

    return {
      favoriteSearchString,
      favoriteUserTagValue,
    };
  },

  hasFavoriteTag(tags: string[] | null | undefined, favoriteUserTagValue: string) {
    return normalizeTags(tags).includes(favoriteUserTagValue);
  },

  addFavoriteTag(tags: string[] | null | undefined, favoriteUserTagValue: string) {
    const normalizedTags = normalizeTags(tags);
    if (normalizedTags.includes(favoriteUserTagValue)) {
      return normalizedTags;
    }
    return [...normalizedTags, favoriteUserTagValue];
  },

  removeFavoriteTag(tags: string[] | null | undefined, favoriteUserTagValue: string) {
    return normalizeTags(tags).filter((tag) => tag !== favoriteUserTagValue);
  },

  buildFavoriteByLibraryItemId(items: Pick<LibraryItem, "id">[]) {
    return items.reduce<Record<string, true>>((acc, item) => {
      if (item.id) {
        acc[item.id] = true;
      }
      return acc;
    }, {});
  },
};
