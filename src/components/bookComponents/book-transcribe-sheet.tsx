import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { transcriptionStore } from "@/store/transcription-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  BookTranscriptionError,
  startBookTranscription,
} from "@/transcription/book-transcription";
import { resolveBookLocale } from "@/transcription/transcription-planning";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasEbookAvailable } from "./ebook-files";
import { showTranscriptionBusyAlert } from "./transcribe-controls";
import { TranscriptionLanguageRow } from "./transcription-language-row";

/**
 * Book Transcript start sheet (plan Phase 4 item 2). This sheet IS the consent
 * step: expectations up front, the language row (silent for English, flagged
 * when the book's metadata says otherwise), and the "you already have an ebook"
 * nudge — never a block.
 */

const EXPECTATION_COPY =
  "Transcription runs on this device while the app is open. A full book can take a while and uses significant battery. The text is machine-generated and will contain errors.";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const BookTranscribeSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const { data: bookData } = useGetItemDetails(libraryItemId);

  const resolvedLocale = resolveBookLocale(bookData ?? null);
  // `null` until the user picks: the row follows the book's metadata language
  // (which only arrives once details load) up to that point.
  const [localeOverride, setLocaleOverride] = useState<string | null>(null);
  const didConfirmLanguage = localeOverride !== null;
  const activeLocale = localeOverride ?? resolvedLocale.localeIdentifier;
  const showEbookNudge = hasEbookAvailable(bookData);

  // A deep link into `book-transcribe` while this sheet is already open swaps it
  // to another book WITHOUT remounting, so the local state survives. A language
  // the user picked for one book must never carry over to a different one —
  // reset it whenever the sheet changes book.
  useEffect(() => {
    // The reset only runs when the route param actually changes books, so the
    // extra render it costs is not a cascade — it mirrors `BookDownloadsSheet`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleOverride(null);
  }, [libraryItemId]);

  const handleStart = () => {
    if (!libraryItemId) return;

    if (transcriptionStore.getState().activeTask) {
      showTranscriptionBusyAlert();
      return;
    }

    // `startBookTranscription` resolves only when the whole book finishes, so it
    // is deliberately not awaited — the card takes over the progress reporting.
    router.back();
    void startBookTranscription(libraryItemId, { localeIdentifier: activeLocale }).catch(
      (error: unknown) => {
        if (error instanceof BookTranscriptionError && error.code === "already_active") {
          showTranscriptionBusyAlert();
          return;
        }
        Alert.alert(
          "Transcription could not start",
          error instanceof Error ? error.message : "Please try again.",
        );
      },
    );
  };

  return (
    <View style={{ flex: 1 }} collapsable={false}>
      <Stack.Screen options={{ title: "Transcribe" }} />
      <ScrollView
        style={{ flex: 1 }}
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        contentContainerStyle={{
          backgroundColor: themeColors.bg,
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 35,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 12,
        }}
      >
        <View
          style={{
            borderRadius: 20,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
            padding: 16,
            gap: 12,
          }}
        >
          <Text selectable style={{ fontSize: 18, fontWeight: "700", color: themeColors.text }}>
            Transcribe this book
          </Text>
          <Text selectable style={{ fontSize: 13, lineHeight: 19, color: themeColors.textMuted }}>
            {EXPECTATION_COPY}
          </Text>

          <TranscriptionLanguageRow
            // Keyed on the book so a picker left expanded on the previous book
            // does not stay open when a deep link swaps this sheet to another.
            key={libraryItemId ?? "none"}
            localeIdentifier={activeLocale}
            needsConfirmation={resolvedLocale.isNonEnglish && !didConfirmLanguage}
            onChange={setLocaleOverride}
          />

          {showEbookNudge ? (
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              This book already has an ebook. A transcript is still available if you want one.
            </Text>
          ) : null}

          {Platform.OS !== "ios" ? (
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              Transcription requires iOS 26.
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={handleStart}
            disabled={!libraryItemId || Platform.OS !== "ios"}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
              opacity: !libraryItemId || Platform.OS !== "ios" ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                textAlign: "center",
                fontSize: 14,
                fontWeight: "700",
                color: themeColors.accentForeground,
              }}
            >
              Start Transcription
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              paddingVertical: 10,
              backgroundColor: themeColors.bg,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: "600",
                color: themeColors.text,
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
};

export default BookTranscribeSheet;
