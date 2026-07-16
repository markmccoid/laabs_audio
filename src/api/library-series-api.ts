import { absClient } from "./abs-client";

export type SeriesBookRef = {
  libraryItemId: string;
  sequence: string | null;
};

export type LibrarySeriesSnapshot = {
  id: string;
  libraryId: string;
  name: string;
  nameSort: string;
  books: SeriesBookRef[];
  createdAt: number | null;
  totalDuration: number | null;
};

type UnknownRecord = Record<string, unknown>;
type SeriesPage = { series: LibrarySeriesSnapshot[]; total: number | null };
type NormalizedSeriesBook = {
  ref: SeriesBookRef;
  duration: number | null;
};

const SERIES_PAGE_SIZE = 200;
const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;
const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);
const asDuration = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const requireLibraryId = (libraryId: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) throw new Error("librarySeriesApi.getLibrarySeries requires a libraryId");
  return trimmed;
};

const toSequence = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const toBookRef = (value: unknown): SeriesBookRef | null => {
  const record = asRecord(value);
  if (!record) return null;
  const libraryItemId = asString(record.id)?.trim() || asString(record.libraryItemId)?.trim();
  if (!libraryItemId) return null;

  const metadata = asRecord(asRecord(record.media)?.metadata);
  const metadataSeries = metadata?.series;
  const seriesRecord = Array.isArray(metadataSeries)
    ? asRecord(metadataSeries[0])
    : asRecord(metadataSeries);
  return {
    libraryItemId,
    sequence:
      toSequence(record.seriesSequence) ??
      toSequence(record.sequence) ??
      toSequence(seriesRecord?.sequence),
  };
};

const normalizeSeriesBook = (value: unknown): NormalizedSeriesBook | null => {
  const ref = toBookRef(value);
  if (!ref) return null;

  const media = asRecord(asRecord(value)?.media);
  return {
    ref,
    duration: asDuration(media?.duration),
  };
};

const totalSeriesDuration = (books: readonly NormalizedSeriesBook[]) => {
  if (books.length === 0 || books.some((book) => book.duration === null)) return null;
  return books.reduce((total, book) => total + (book.duration ?? 0), 0);
};

const normalizeSeries = (value: unknown, libraryId: string): LibrarySeriesSnapshot | null => {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id)?.trim();
  if (!id) return null;

  const normalizedBooks = Array.isArray(record.books)
    ? record.books
        .map(normalizeSeriesBook)
        .filter((book): book is NormalizedSeriesBook => Boolean(book))
    : [];
  return {
    id,
    libraryId,
    name: asString(record.name)?.trim() || "Untitled Series",
    nameSort:
      asString(record.nameIgnorePrefixSort)?.trim() ||
      asString(record.nameIgnorePrefix)?.trim() ||
      asString(record.name)?.trim() ||
      "Untitled Series",
    books: normalizedBooks.map((book) => book.ref),
    createdAt: asNumber(record.createdAt),
    totalDuration: totalSeriesDuration(normalizedBooks),
  };
};

const extractPage = (payload: unknown, libraryId: string): SeriesPage => {
  if (Array.isArray(payload)) {
    return {
      series: payload
        .map((value) => normalizeSeries(value, libraryId))
        .filter((value): value is LibrarySeriesSnapshot => Boolean(value)),
      total: null,
    };
  }
  const record = asRecord(payload);
  const results = Array.isArray(record?.results) ? record.results : [];
  return {
    series: results
      .map((value) => normalizeSeries(value, libraryId))
      .filter((value): value is LibrarySeriesSnapshot => Boolean(value)),
    total: asNumber(record?.total),
  };
};

export const librarySeriesApi = {
  async getLibrarySeries(libraryId: string): Promise<LibrarySeriesSnapshot[]> {
    const libraryIdToUse = requireLibraryId(libraryId);
    const allSeries: LibrarySeriesSnapshot[] = [];
    let page = 0;
    let total: number | null = null;

    do {
      const payload = await absClient.get<unknown>(
        `/api/libraries/${libraryIdToUse}/series?minified=1&limit=${SERIES_PAGE_SIZE}&page=${page}`,
      );
      const response = extractPage(payload, libraryIdToUse);
      allSeries.push(...response.series);
      total ??= response.total;
      page += 1;

      if (response.series.length < SERIES_PAGE_SIZE) break;
    } while (total === null || allSeries.length < total);

    return allSeries;
  },
};
