import { extractBookDetailIdFromUrl } from "../navigation/book-links";

// Expo Router routes every incoming URL on its own. For book links that arrive
// while the app is running (widget taps, shared links), that pushes a second
// detail screen even when the same book is already visible.
// useAssistantOpenNavigation owns warm book links instead: it skips the visible
// book and pushes otherwise. Cold-start links still route through Expo Router.
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  if (!initial && extractBookDetailIdFromUrl(path)) return null;
  return path;
}
