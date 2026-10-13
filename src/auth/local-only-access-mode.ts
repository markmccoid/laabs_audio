import type { AccessMode } from "./auth-store";

/** Access Modes without server browsing: no Active Library, only books stored on this device. */
export const isLocalOnlyAccessMode = (accessMode: AccessMode) =>
  accessMode === "downloadedOnly" ||
  accessMode === "downloadedSessionOnly" ||
  accessMode === "importedOnly";
