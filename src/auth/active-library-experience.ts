import { useAuthStore, type AuthState } from "./auth-store";

export type ActiveLibraryExperience = "book" | "podcast" | "unresolved";

type ActiveLibraryExperienceState = Pick<
  AuthState,
  "activeLibraryId" | "activeLibraryMediaType" | "activeLibraryReady"
>;

/**
 * The single media-specific dispatch seam for the Active Library.
 *
 * Unknown media types and Libraries still awaiting activation are unresolved;
 * callers must not assume that either case is a Book Library.
 */
export const selectActiveLibraryExperience = (
  state: ActiveLibraryExperienceState,
): ActiveLibraryExperience => {
  if (!state.activeLibraryId || !state.activeLibraryReady) return "unresolved";

  const mediaType = state.activeLibraryMediaType?.trim().toLowerCase();
  if (mediaType === "book" || mediaType === "podcast") return mediaType;

  return "unresolved";
};

export const useActiveLibraryExperience = () =>
  useAuthStore(selectActiveLibraryExperience);
