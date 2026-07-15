export type CatalogSortBy = "addedAt" | "author" | "title" | "duration" | "publishedYear";
export type CatalogSortDirection = "asc" | "desc";

export const CATALOG_SORT_OPTIONS: { value: CatalogSortBy; label: string }[] = [
  { value: "author", label: "Author" },
  { value: "title", label: "Title" },
  { value: "addedAt", label: "Added At" },
  { value: "duration", label: "Duration" },
  { value: "publishedYear", label: "Published" },
];
