import { absClient } from "./abs-client";
import { authorsApi } from "./authors-api";
import { buildCoverUrls } from "./cover-urls";
import type { LibraryItem, PodcastEpisode, UserMediaProgress } from "../types/absTypes";

export type ItemDetails = {
  id: string;
  audioFiles: LibraryItem["media"]["audioFiles"];
  media: LibraryItem["media"];
  bookDuration: number;
  userMediaProgress?: UserMediaProgress;
  coverUri: string;
  authorBookCount: number;
  updatedAt: number;
  libraryFiles: LibraryItem["libraryFiles"];
};

export type PodcastItemDetails = {
  id: string;
  media: LibraryItem["media"];
  episodes: PodcastEpisode[];
  podcastType: string | null;
  title: string;
  author: string | null;
  description: string | null;
  coverUri: string;
  numEpisodes: number | null;
  updatedAt: number;
};

export const itemsApi = {
  async getItemDetails(itemId: string): Promise<ItemDetails> {
    const response = await absClient.get<LibraryItem>(
      `/api/items/${itemId}?expanded=1&include=progress`,
    );

    if (!response?.media?.audioFiles) {
      throw new Error("No media or audio files found");
    }

    const authorId = response.media.metadata?.authors?.[0]?.id;
    let authorBookCount = 0;

    if (authorId) {
      const authorResponse = await authorsApi.getAuthorWithItems(authorId);
      authorBookCount = authorResponse.libraryItems.length;
    }

    const coverUrls = buildCoverUrls(response.id, { version: response.updatedAt });

    return {
      id: response.id,
      audioFiles: response.media.audioFiles,
      media: response.media,
      bookDuration: response.media.duration,
      userMediaProgress: response.userMediaProgress,
      coverUri: coverUrls.full,
      authorBookCount,
      updatedAt: response.updatedAt,
      libraryFiles: response.libraryFiles,
    };
  },

  async getPodcastItemDetails(itemId: string): Promise<PodcastItemDetails> {
    const response = await absClient.get<LibraryItem>(
      `/api/items/${itemId}?expanded=1&include=progress`,
    );

    if (!response?.media) {
      throw new Error("No podcast media found");
    }

    const metadata = response.media.metadata;
    const episodes = Array.isArray(response.media.episodes) ? response.media.episodes : [];
    const coverUrls = buildCoverUrls(response.id, { version: response.updatedAt });

    return {
      id: response.id,
      media: response.media,
      episodes,
      podcastType: metadata?.type ?? null,
      title: metadata?.title ?? "Podcast",
      author: metadata?.author ?? metadata?.authorName ?? null,
      description: metadata?.descriptionPlain ?? metadata?.description ?? null,
      coverUri: coverUrls.full,
      numEpisodes: response.media.numEpisodes ?? episodes.length,
      updatedAt: response.updatedAt,
    };
  },

  updateMediaTags(itemId: string, tags: string[]) {
    return absClient.patch<void>(`/api/items/${itemId}/media`, { tags });
  },
};
