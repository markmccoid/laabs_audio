import type { SeriesSummary } from "@/data/sqlite/series-repository";

export type SeriesSortBy = "name" | "bookCount" | "totalDuration" | "createdAt";
export type SeriesSortDirection = "asc" | "desc";

export const SERIES_SORT_OPTIONS: readonly { value: SeriesSortBy; label: string }[] = [
  { value: "name", label: "Series Name" },
  { value: "bookCount", label: "Number of Books" },
  { value: "totalDuration", label: "Total Duration" },
  { value: "createdAt", label: "Date Added" },
];

const compareNullableNumbers = (
  first: number | null,
  second: number | null,
  direction: SeriesSortDirection,
) => {
  if (first === null && second === null) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return (first - second) * (direction === "asc" ? 1 : -1);
};

export const sortSeries = (
  series: readonly SeriesSummary[],
  sortedBy: SeriesSortBy,
  direction: SeriesSortDirection,
) => {
  const multiplier = direction === "asc" ? 1 : -1;
  return series.slice().sort((first, second) => {
    let result: number;
    switch (sortedBy) {
      case "bookCount":
        result = (first.bookCount - second.bookCount) * multiplier;
        break;
      case "totalDuration":
        result = compareNullableNumbers(first.totalDuration, second.totalDuration, direction);
        break;
      case "createdAt":
        result = compareNullableNumbers(first.createdAt, second.createdAt, direction);
        break;
      case "name":
        result = first.name.localeCompare(second.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }) * multiplier;
        break;
    }
    if (result !== 0) return result;
    return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
  });
};
