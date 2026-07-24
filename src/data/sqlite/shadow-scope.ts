import { authStore } from "@/auth/auth-store";

// The single place the shadow SQLite read model binds to global auth state.
// Every module resolves its user/library scope through here; callers that
// captured a scope earlier (e.g. the Library Refresh Coordinator's in-flight
// dedup) pass it back so a mid-operation Active Library switch fails loudly
// instead of writing rows under the wrong library.
export type SqliteLibraryScope = {
  userId: string;
  libraryId: string;
};

export type ActiveLibraryContext = SqliteLibraryScope & {
  libraryName: string;
};

export const requireActiveLibraryContext = (
  expectedScope?: SqliteLibraryScope,
): ActiveLibraryContext => {
  const state = authStore.getState();
  const userId = state.activeLibraryUserKey?.trim();
  const libraryId = state.activeLibraryId?.trim();
  const libraryName = state.activeLibraryName?.trim() || "Active Library";

  if (state.status !== "authenticated" || !userId || !libraryId) {
    throw new Error("Shadow SQLite requires an authenticated User Session with an Active Library.");
  }

  if (expectedScope && (expectedScope.userId !== userId || expectedScope.libraryId !== libraryId)) {
    throw new Error(
      "Shadow SQLite scope mismatch: the Active Library changed after this operation was scheduled.",
    );
  }

  return { userId, libraryId, libraryName };
};

/**
 * Scope for podcast series-index refresh before Active Library commit.
 * Requires an authenticated User Session matching `scope.userId`, but does not
 * require the target Library to already be the Active Library.
 */
export const requireAuthenticatedLibraryScope = (scope: {
  userId: string;
  libraryId: string;
  libraryName: string;
}): ActiveLibraryContext => {
  const state = authStore.getState();
  const sessionUserId = state.activeLibraryUserKey?.trim();

  if (state.status !== "authenticated" || !sessionUserId) {
    throw new Error(
      "Shadow SQLite requires an authenticated User Session for Podcast Series Index refresh.",
    );
  }

  if (sessionUserId !== scope.userId.trim()) {
    throw new Error("Shadow SQLite scope mismatch: User Session does not match refresh scope.");
  }

  const libraryId = scope.libraryId.trim();
  if (!libraryId) {
    throw new Error("Shadow SQLite requires a libraryId for Podcast Series Index refresh.");
  }

  return {
    userId: scope.userId.trim(),
    libraryId,
    libraryName: scope.libraryName.trim() || "Podcast Library",
  };
};
