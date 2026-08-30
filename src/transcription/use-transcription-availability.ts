import { useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  getBookTranscriptionAvailability,
  type BookTranscriptionAvailability,
} from "@/native/book-transcriber";
import { DEFAULT_TRANSCRIPTION_LOCALE } from "./transcription-planning";

/**
 * Book Transcript availability for the UI (plan Phase 4). The native check hits
 * `SpeechTranscriber.supportedLocales`, so it is asked once per locale and the
 * promise is cached for the life of the process — never per render.
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

const availabilityByLocale = new Map<string, Promise<BookTranscriptionAvailability>>();

export const getCachedTranscriptionAvailability = (
  localeIdentifier: string = DEFAULT_TRANSCRIPTION_LOCALE,
): Promise<BookTranscriptionAvailability> => {
  if (Platform.OS !== "ios") return Promise.resolve(UNAVAILABLE_OFF_PLATFORM);

  const cached = availabilityByLocale.get(localeIdentifier);
  if (cached) return cached;

  const pending = getBookTranscriptionAvailability({ localeIdentifier }).catch(
    () => UNAVAILABLE_OFF_PLATFORM,
  );
  availabilityByLocale.set(localeIdentifier, pending);
  return pending;
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
