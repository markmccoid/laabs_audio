import { extractBookDetailIdFromUrl } from "./book-links";

export const resolveAssistantOpenLibraryItemId = ({
  url,
  pendingLibraryItemId,
}: {
  url?: string | null;
  pendingLibraryItemId?: string | null;
}) => {
  const fromUrl = extractBookDetailIdFromUrl(url);
  if (fromUrl) return fromUrl;
  const pending = pendingLibraryItemId?.trim();
  return pending ? pending : undefined;
};
