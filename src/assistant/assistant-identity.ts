export type AssistantBookIdentity = {
  userId: string;
  libraryItemId: string;
};

const validPart = (value: string) => value.length > 0 && !value.includes("|");

export const formatAssistantBookId = ({
  userId,
  libraryItemId,
}: AssistantBookIdentity): string => {
  if (!validPart(userId) || !validPart(libraryItemId)) {
    throw new Error("Assistant Book identity parts must be non-empty and cannot contain '|'.");
  }
  return `${userId}|${libraryItemId}`;
};

export const parseAssistantBookId = (value: string): AssistantBookIdentity | null => {
  const parts = value.split("|");
  if (parts.length !== 2) return null;
  const [userId, libraryItemId] = parts;
  if (!userId || !libraryItemId) return null;
  return { userId, libraryItemId };
};

export const parseAssistantBookIdForUser = (
  value: string,
  expectedUserId: string,
): AssistantBookIdentity | null => {
  const identity = parseAssistantBookId(value);
  return identity?.userId === expectedUserId ? identity : null;
};
