import { useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  getBookTranscriptionAvailability,
  type BookTranscriptionAvailability,
} from "@/native/book-transcriber";
import { DEFAULT_TRANSCRIPTION_LOCALE } from "./transcription-planning";

/**
 * Book Transcript availability for the UI (plan Phase 4). The native check hits
 * `SpeechTranscriber.supportedLocales`, so it is asked per locale and the
 * promise is cached — never per render.
 *
 * An *available* answer is cached for the life of the process. An *unavailable*
 * one only holds for `UNAVAILABLE_TTL_MS`: the speech model can be installed, or
 * Apple Intelligence turned on, mid-session, and the card must notice that
 * without an app restart.
 *
 * Book Transcription is iOS 26+ only (ADR-0034); every other platform short
 * circuits to unavailable without touching the native module.
 */

const UNAVAILABLE_OFF_PLATFORM: BookTranscriptionAvailability = {
  available: false,
  reason: "unavailable",
  localeSupported: false,
  modelInstalled: false,
};

/** How long an "unavailable" answer is trusted before the native check is re-run. */
const UNAVAILABLE_TTL_MS = 30_000;

type AvailabilityCacheEntry = {
  promise: Promise<BookTranscriptionAvailability>;
  /** When an unavailable answer landed. `null` while pending, or when available. */
  unavailableAt: number | null;
};

const availabilityByLocale = new Map<string, AvailabilityCacheEntry>();

const isCacheEntryFresh = (entry: AvailabilityCacheEntry) =>
  entry.unavailableAt === null || Date.now() - entry.unavailableAt < UNAVAILABLE_TTL_MS;

export const getCachedTranscriptionAvailability = (
  localeIdentifier: string = DEFAULT_TRANSCRIPTION_LOCALE,
): Promise<BookTranscriptionAvailability> => {
  if (Platform.OS !== "ios") return Promise.resolve(UNAVAILABLE_OFF_PLATFORM);

  const cached = availabilityByLocale.get(localeIdentifier);
  if (cached && isCacheEntryFresh(cached)) return cached.promise;

  const entry: AvailabilityCacheEntry = {
    unavailableAt: null,
    promise: getBookTranscriptionAvailability({ localeIdentifier })
      .catch(() => UNAVAILABLE_OFF_PLATFORM)
      .then((resolved) => {
        // Stamping only the unavailable answers is what makes them expire; an
        // available one stays cached for the life of the process.
        if (!resolved.available) entry.unavailableAt = Date.now();
        return resolved;
      }),
  };
  availabilityByLocale.set(localeIdentifier, entry);
  return entry.promise;
};

/** The message shown on the card when transcription cannot run here. */
export const describeTranscriptionUnavailable = (
  availability: BookTranscriptionAvailability,
  localeIdentifier: string = DEFAULT_TRANSCRIPTION_LOCALE,
) => {
  if (availability.reason === "requires_ios26") return "Transcription requires iOS 26.";
  if (availability.reason === "locale_unsupported") {
    return `Transcription is not available for ${localeIdentifier}.`;
  }
  return "Transcription is not available on this device.";
};

/**
 * `null` while the (cached) native check is still in flight — callers render
 * nothing until it resolves rather than flashing an unavailable message.
 */
export const useTranscriptionAvailability = (
  localeIdentifier: string = DEFAULT_TRANSCRIPTION_LOCALE,
): BookTranscriptionAvailability | null => {
  const [availability, setAvailability] = useState<BookTranscriptionAvailability | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void getCachedTranscriptionAvailability(localeIdentifier).then((resolved) => {
      if (!isCancelled) setAvailability(resolved);
    });
    return () => {
      isCancelled = true;
    };
  }, [localeIdentifier]);

  return availability;
};
