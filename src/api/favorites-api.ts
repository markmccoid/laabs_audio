import { authStore } from "../auth/auth-store";
import type { LibraryItem } from "../types/absTypes";

export type FavoriteInfo = {
  favoriteSearchString: string;
  favoriteUserTagValue: string;
};

const normalizeTags = (tags?: string[] | null) => tags?.filter(Boolean) ?? [];

export const favoritesApi = {
  getUserFavoriteInfo(): FavoriteInfo {
    const { storedUsername } = authStore.getState();

    if (!storedUsername) {
      throw new Error("Missing username for favorite tagging");
    }

    const favoriteUserTagValue = `${storedUsername}-laab-favorite`;
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
