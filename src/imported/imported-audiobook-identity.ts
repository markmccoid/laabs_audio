/**
 * Identity for Imported Audiobooks (CONTEXT.md: Imported Audiobook, Device Listener; ADR-0044, ADR-0045).
 *
 * An Imported Audiobook id is a prefixed string that fits anywhere a library item id goes
 * (playback loading, the persisted playback pointer, bookmark keys). The prefix is what keeps
 * it away from every Audiobookshelf server path.
 */
export const IMPORTED_AUDIOBOOK_ID_PREFIX = "imp_";

/**
 * The Listening State Owner for every Imported Audiobook: one device-wide owner shared by all
 * User Sessions and by no User Session. Never an Audiobookshelf User Identity, never synced.
 */
export const DEVICE_LISTENER_KEY = "device-listener";

export const isImportedAudiobookId = (id: string | null | undefined): id is string =>
  typeof id === "string" && id.startsWith(IMPORTED_AUDIOBOOK_ID_PREFIX);

const randomHex = (length: number) => {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += Math.floor(Math.random() * 16).toString(16);
  }
  return value;
};

export const createImportedAudiobookId = () =>
  `${IMPORTED_AUDIOBOOK_ID_PREFIX}${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(
    8 + Math.floor(Math.random() * 4)
  ).toString(16)}${randomHex(3)}-${randomHex(12)}`;

/** True when `text` (an API path or serialized body) references an Imported Audiobook id. */
export const referencesImportedAudiobookId = (text: string | null | undefined) =>
  typeof text === "string" && /(^|[^A-Za-z0-9])imp_[0-9a-f]{8}-/.test(text);

export class ImportedAudiobookServerRequestError extends Error {
  constructor(path: string) {
    super(`Imported Audiobooks never reach Audiobookshelf (blocked request: ${path})`);
    this.name = "ImportedAudiobookServerRequestError";
  }
}
