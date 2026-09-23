import type { AssistantPendingSearch } from "@/native/assistant";

export const ASSISTANT_SEARCH_QUERY_MAX_LENGTH = 200;

export type AssistantSearchDelivery =
  | { kind: "none" }
  | { kind: "wait" }
  | { kind: "discard" }
  | { kind: "navigate"; search: AssistantPendingSearch };

const cleanText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\u0000") || trimmed.length > maxLength) return null;
  return trimmed;
};

export const parseAssistantPendingSearch = (value: unknown): AssistantPendingSearch | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const query = cleanText(record.query, ASSISTANT_SEARCH_QUERY_MAX_LENGTH);
  const userId = cleanText(record.userId, 256);
  const libraryId = cleanText(record.libraryId, 256);
  if (!query || !userId || !libraryId) return null;
  return { query, userId, libraryId };
};

export const resolveAssistantSearchDelivery = ({
  pending,
  currentUserId,
  activeLibraryId,
  isAuthenticated,
}: {
  pending: unknown;
  currentUserId: string | null;
  activeLibraryId: string | null;
  isAuthenticated: boolean;
}): AssistantSearchDelivery => {
  const search = parseAssistantPendingSearch(pending);
  if (!search) return { kind: "none" };
  const sessionId = currentUserId?.trim() || null;
  const libraryId = activeLibraryId?.trim() || null;
  if (!sessionId || !libraryId) return { kind: "wait" };
  if (sessionId !== search.userId || libraryId !== search.libraryId) return { kind: "discard" };
  if (!isAuthenticated) return { kind: "discard" };
  return { kind: "navigate", search };
};

export const shouldTakeAssistantSearch = (delivery: AssistantSearchDelivery) => {
  switch (delivery.kind) {
    case "navigate":
    case "discard":
      return true;
    case "none":
    case "wait":
      return false;
    default: {
      const unhandled: never = delivery;
      return unhandled;
    }
  }
};
