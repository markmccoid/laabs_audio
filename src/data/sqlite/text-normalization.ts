// Shared normalization for the shadow SQLite read model.
//
// Invariant: catalog refresh writes normalized columns (title_sort, author_sort,
// normalized_value on genre/tag rows, FTS content) with this function, and the
// Search Expression builds match clauses with the same function. Index-time and
// query-time normalization must stay identical or facet and FTS matching breaks.
export const normalizeText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
