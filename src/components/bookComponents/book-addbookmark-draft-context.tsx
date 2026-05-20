import { usePlaybackStore } from "@/player";
import type { LocalBookmarkRecord } from "@/store/device-books-store";
import { formatSeconds } from "@/utils/formatUtils";
import { useLocalSearchParams } from "expo-router";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  clampSeconds,
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "./clip-timing";

type BookmarkDraftKind = "point" | "clip";

type BookmarkDraftState = {
  kind: BookmarkDraftKind;
  sourceBookmarkId?: string | null;
  sourceBookmarkKind?: BookmarkDraftKind | null;
  libraryItemId?: string;
  title: string;
  localNote: string;
  positionSeconds: number;
  clipEndSeconds: number | null;
  createdAt?: number;
};

type BookmarkDraftContextValue = BookmarkDraftState & {
  setTitle: (title: string) => void;
  setLocalNote: (localNote: string) => void;
  setPointPosition: (positionSeconds: number) => void;
  setClipRange: (startSeconds: number, endSeconds: number) => void;
  convertToClipDraft: (options?: { durationSeconds?: number; bookDurationSeconds?: number }) => void;
  removeClip: () => void;
  seedFromBookmark: (bookmark: LocalBookmarkRecord) => void;
};

const BookmarkDraftContext = createContext<BookmarkDraftContextValue | null>(null);

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const DEFAULT_CREATE_CLIP_DURATION_SECONDS = 30;

export const formatBookmarkDraftTime = (seconds: number) =>
  formatSeconds(seconds, "compact", true, true) ?? "00:00";

export const formatBookmarkDraftDuration = (seconds: number) => {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};

export const BookAddBookmarkDraftProvider = ({ children }: { children: ReactNode }) => {
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam) ?? playbackLibraryItemId ?? undefined;
  const [draft, setDraft] = useState<BookmarkDraftState>(() => ({
    kind: "point",
    sourceBookmarkId: null,
    sourceBookmarkKind: null,
    libraryItemId,
    title: "",
    localNote: "",
    positionSeconds: Math.max(0, Math.round(playbackPositionMs / 1000)),
    clipEndSeconds: null,
    createdAt: Date.now(),
  }));

  const value = useMemo<BookmarkDraftContextValue>(
    () => ({
      ...draft,
      libraryItemId: draft.libraryItemId ?? libraryItemId,
      setTitle: (title) => {
        setDraft((current) => ({ ...current, title }));
      },
      setLocalNote: (localNote) => {
        setDraft((current) => ({ ...current, localNote }));
      },
      setPointPosition: (positionSeconds) => {
        setDraft((current) => ({
          ...current,
          positionSeconds: Math.max(0, Math.round(positionSeconds)),
        }));
      },
      setClipRange: (startSeconds, endSeconds) => {
        const normalizedStartSeconds = Math.max(0, Math.round(startSeconds));
        const normalizedEndSeconds = Math.max(
          normalizedStartSeconds + MIN_CLIP_DURATION_SECONDS,
          Math.round(endSeconds),
        );
        setDraft((current) => ({
          ...current,
          kind: "clip",
          positionSeconds: normalizedStartSeconds,
          clipEndSeconds: normalizedEndSeconds,
        }));
      },
      convertToClipDraft: (options) => {
        setDraft((current) => {
          if (current.kind === "clip" && current.clipEndSeconds !== null) return current;
          const bookDurationSeconds = options?.bookDurationSeconds;
          const maxDurationForStart =
            bookDurationSeconds && bookDurationSeconds > current.positionSeconds
              ? Math.max(
                  MIN_CLIP_DURATION_SECONDS,
                  Math.min(MAX_CLIP_DURATION_SECONDS, bookDurationSeconds - current.positionSeconds),
                )
              : MAX_CLIP_DURATION_SECONDS;
          const durationSeconds = clampSeconds(
            options?.durationSeconds ?? DEFAULT_CREATE_CLIP_DURATION_SECONDS,
            MIN_CLIP_DURATION_SECONDS,
            maxDurationForStart,
          );
          return {
            ...current,
            kind: "clip",
            clipEndSeconds: current.positionSeconds + durationSeconds,
          };
        });
      },
      removeClip: () => {
        setDraft((current) => ({
          ...current,
          kind: "point",
          clipEndSeconds: null,
        }));
      },
      seedFromBookmark: (bookmark) => {
        setDraft({
          kind: bookmark.kind,
          sourceBookmarkId: bookmark.id,
          sourceBookmarkKind: bookmark.kind,
          libraryItemId: bookmark.libraryItemId,
          title: bookmark.title,
          localNote: bookmark.note ?? "",
          positionSeconds: bookmark.startTimeSeconds,
          clipEndSeconds: bookmark.kind === "clip" ? (bookmark.endTimeSeconds ?? null) : null,
          createdAt: bookmark.createdAt,
        });
      },
    }),
    [draft, libraryItemId],
  );

  return <BookmarkDraftContext.Provider value={value}>{children}</BookmarkDraftContext.Provider>;
};

export const useBookAddBookmarkDraft = () => {
  const context = useContext(BookmarkDraftContext);
  if (!context) {
    throw new Error("useBookAddBookmarkDraft must be used within BookAddBookmarkDraftProvider");
  }
  return context;
};
