import type { SQLiteBindValue } from "expo-sqlite";
import { normalizeText } from "./text-normalization";

// Pure builder for the Search Result Set SQL expression. No database handle,
// no auth store — scope is explicit so the same expression backs both the
// production reader and the Settings diagnostic sampler.

export type SqliteSearchScope = {
  userId: string;
  libraryId: string;
};

export type ShadowSearchParams = {
  query?: string;
  genres?: string[];
  genreOperator?: "and" | "or";
  tags?: string[];
  tagOperator?: "and" | "or";
  author?: string;
  narrator?: string;
  favoriteFilter?: "all" | "only" | "exclude";
  finishedOnly?: boolean;
  sortBy?: "addedAt" | "author" | "title" | "duration" | "publishedYear";
  sortDirection?: "asc" | "desc";
};

export type SearchExpression = {
  fromSql: string;
  whereSql: string;
  orderSql: string;
  bindings: SQLiteBindValue[];
  usedFts: boolean;
};

export const normalizeFacetValues = (values: string[] | null | undefined) =>
  Array.from(new Set((values ?? []).map(normalizeText).filter(Boolean)));

export const toFtsQuery = (value: string | null | undefined) =>
  normalizeText(value)
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9_]/gi, ""))
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" ");

const buildFacetClause = (
  tableName: "catalog_item_genres" | "catalog_item_tags",
  values: string[],
  operator: "and" | "or",
  params: SQLiteBindValue[],
) => {
  const normalized = normalizeFacetValues(values);
  if (normalized.length === 0) return "";

  params.push(...normalized);
  const placeholders = normalized.map(() => "?").join(", ");
  const comparator = operator === "and" ? `= ${normalized.length}` : ">= 1";

  return `item.library_item_id IN (
    SELECT library_item_id
    FROM ${tableName}
    WHERE user_id = ?
      AND library_id = ?
      AND normalized_value IN (${placeholders})
    GROUP BY library_item_id
    HAVING COUNT(DISTINCT normalized_value) ${comparator}
  )`;
};

const sortColumnFor = (sortBy: NonNullable<ShadowSearchParams["sortBy"]>) => {
  switch (sortBy) {
    case "author":
      return "item.author_sort";
    case "title":
      return "item.title_sort";
    case "duration":
      return "item.duration";
    case "publishedYear":
      return "item.published_year_sort";
    case "addedAt":
    default:
      return "item.added_at";
  }
};

export const buildSearchExpression = (
  scope: SqliteSearchScope,
  params: ShadowSearchParams = {},
): SearchExpression => {
  const query = toFtsQuery(params.query);
  const usedFts = query.length > 0;
  const bindings: SQLiteBindValue[] = [scope.userId, scope.libraryId];
  const joins: string[] = [];
  const clauses: string[] = [
    "item.user_id = ?",
    "item.library_id = ?",
    "item.is_missing = 0",
    "COALESCE(item.num_audio_files, 0) > 0",
  ];

  if (usedFts) {
    joins.push(`JOIN library_catalog_fts fts
      ON fts.user_id = item.user_id
      AND fts.library_id = item.library_id
      AND fts.library_item_id = item.library_item_id`);
    clauses.push("library_catalog_fts MATCH ?");
    bindings.push(query);
  }

  const genreValues = normalizeFacetValues(params.genres);
  if (genreValues.length > 0) {
    bindings.push(scope.userId, scope.libraryId);
    clauses.push(
      buildFacetClause("catalog_item_genres", genreValues, params.genreOperator ?? "or", bindings),
    );
  }

  const tagValues = normalizeFacetValues(params.tags);
  if (tagValues.length > 0) {
    bindings.push(scope.userId, scope.libraryId);
    clauses.push(
      buildFacetClause("catalog_item_tags", tagValues, params.tagOperator ?? "or", bindings),
    );
  }

  if (params.author) {
    clauses.push("COALESCE(item.author, '') = ?");
    bindings.push(params.author);
  }

  if (params.narrator) {
    clauses.push("COALESCE(item.narrator, '') = ?");
    bindings.push(params.narrator);
  }

  if (params.favoriteFilter === "only") {
    clauses.push(`EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  } else if (params.favoriteFilter === "exclude") {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM user_favorites favorite
      WHERE favorite.user_id = item.user_id
        AND favorite.library_item_id = item.library_item_id
    )`);
  }

  if (params.finishedOnly) {
    clauses.push(`EXISTS (
      SELECT 1 FROM effective_progress progress
      WHERE progress.user_id = item.user_id
        AND progress.library_id = item.library_id
        AND progress.library_item_id = item.library_item_id
        AND progress.is_finished = 1
    )`);
  }

  const sortDirection = params.sortDirection === "asc" ? "ASC" : "DESC";
  const sortBy = params.sortBy ?? "addedAt";

  return {
    fromSql: `FROM library_catalog_items item ${joins.join("\n")}`,
    whereSql: clauses.join("\nAND "),
    orderSql: `ORDER BY ${sortColumnFor(sortBy)} ${sortDirection}, item.library_item_id ASC`,
    bindings,
    usedFts,
  };
};
