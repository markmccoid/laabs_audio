import { authStore } from "../auth/auth-store";

export type FavoriteInfo = {
  favoriteSearchString: string;
  favoriteUserTagValue: string;
};

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
};
