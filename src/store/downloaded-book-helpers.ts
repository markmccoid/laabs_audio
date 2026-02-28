import type { LibraryItemSummary } from "../api/library-items-api";
import type { ItemDetails } from "../api/items-api";

export const resolvePreferredCoverUri = (
  coverLocalUri?: string | null,
  fallbackCoverUri?: string | null,
) => coverLocalUri ?? fallbackCoverUri ?? null;

export const toDownloadedBookSummary = (
  details: ItemDetails,
  coverLocalUri?: string | null,
): LibraryItemSummary => {
  const metadata = details.media.metadata;
  const authors = metadata.authors?.map((author) => author.name).filter(Boolean).join(", ");
  const narrators = metadata.narrators?.filter(Boolean).join(", ");
  const series = metadata.series?.map((item) => item.name).filter(Boolean).join(", ");
  const coverUri = resolvePreferredCoverUri(coverLocalUri, details.coverUri) ?? details.coverUri;

  return {
    id: details.id,
    title: metadata.title,
    subtitle: metadata.subtitle,
    author: metadata.authorName ?? authors ?? null,
    series: metadata.seriesName ?? series ?? null,
    publishedDate: metadata.publishedDate,
    publishedYear: metadata.publishedYear,
    narratedBy: metadata.narratorName ?? narrators ?? null,
    description: metadata.description ?? metadata.descriptionPlain ?? null,
    duration: details.media.duration,
    addedAt: details.updatedAt,
    updatedAt: details.updatedAt,
    cover: coverUri,
    coverFull: coverUri,
    numAudioFiles: details.audioFiles.length,
    ebookFormat: details.media.ebookFormat ?? null,
    genres: metadata.genres ?? [],
    tags: details.media.tags ?? [],
    asin: metadata.asin ?? null,
  };
};
