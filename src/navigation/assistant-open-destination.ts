import { extractBookDetailIdFromUrl } from "./book-links";

let inFlightLibraryItemId: string | null = null;

const cleanLibraryItemId = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const rememberAssistantOpenInFlight = (libraryItemId: string) => {
  inFlightLibraryItemId = cleanLibraryItemId(libraryItemId) ?? null;
};

export const peekAssistantOpenInFlight = () => inFlightLibraryItemId;

export const clearAssistantOpenInFlight = () => {
  inFlightLibraryItemId = null;
};

export const resolveAssistantOpenHoldId = ({
  pending,
  inFlight = peekAssistantOpenInFlight(),
}: {
  pending?: string | null;
  inFlight?: string | null;
}) => cleanLibraryItemId(pending) ?? cleanLibraryItemId(inFlight);

export const resolveAssistantOpenLibraryItemId = ({
  url,
  pendingLibraryItemId,
}: {
  url?: string | null;
  pendingLibraryItemId?: string | null;
}) => {
  const fromUrl = extractBookDetailIdFromUrl(url);
  if (fromUrl) return fromUrl;
  return cleanLibraryItemId(pendingLibraryItemId);
};
