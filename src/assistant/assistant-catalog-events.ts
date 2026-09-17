export type AssistantCatalogChangeReason =
  | "rebuilt"
  | "progress"
  | "favorite"
  | "downloaded"
  | "cleared";

export type AssistantCatalogChangedEvent = {
  userId: string | null;
  reason: AssistantCatalogChangeReason;
};

type AssistantCatalogChangedListener = (event: AssistantCatalogChangedEvent) => void;

const listeners = new Set<AssistantCatalogChangedListener>();

export const emitAssistantCatalogChanged = (event: AssistantCatalogChangedEvent): void => {
  for (const listener of listeners) listener(event);
};

export const subscribeAssistantCatalogChanged = (
  listener: AssistantCatalogChangedListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
