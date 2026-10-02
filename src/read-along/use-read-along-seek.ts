import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "react-native-sonner";
import { playbackStore } from "@/player/playback-store";
import { playerService } from "@/player/player-service";
import { getPlaybackErrorPresentation } from "@/player/playback-error-presentation";
import { interpolatePosition } from "./read-along-sync";

/** Document seeks preserve playback state and offer one return to the pre-seek Listening Position. */
export const useReadAlongSeek = (bookId: string | null, onSeek: () => void) => {
  const toastId = useId();
  const [isSeeking, setIsSeeking] = useState(false);
  const pending = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const noticeId = useRef<string | null>(null);
  const dismissNotice = useCallback(() => {
    if (noticeId.current) toast.dismiss(noticeId.current);
    noticeId.current = null;
  }, []);
  const invalidateUndo = useCallback(() => {
    sequence.current++;
    dismissNotice();
  }, [dismissNotice]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateUndo();
    };
  }, [bookId, invalidateUndo]);

  const seek = useCallback(
    async (targetMs: number) => {
      const before = { ...playbackStore.getState() };
      if (
        pending.current ||
        !bookId ||
        before.libraryItemId !== bookId ||
        before.episodeId ||
        !before.queue.length ||
        !Number.isFinite(targetMs)
      )
        return false;

      const request = ++sequence.current;
      const samePlayback = () => {
        const current = playbackStore.getState();
        return (
          mounted.current &&
          request === sequence.current &&
          current.libraryItemId === bookId &&
          current.ownerId === before.ownerId &&
          current.queue === before.queue &&
          !current.episodeId &&
          current.queue.length > 0
        );
      };
      const previousMs = interpolatePosition(
        {
          positionMs: before.positionMs,
          anchoredAtMs: before.positionUpdatedAtMs,
          rate: before.rate,
          isPlaying:
            before.playbackState === "playing" &&
            before.positionUpdatedAtMs > 0,
        },
        Date.now(),
      );

      const apply = async (positionMs: number) => {
        const start = { ...playbackStore.getState() };
        const wasPlaying = start.playbackState === "playing";
        pending.current = true;
        setIsSeeking(true);
        try {
          try {
            await playerService.seekTo(positionMs);
          } catch (error) {
            // seekTo publishes confirmed engine position before awaiting its native
            // checkpoint. That checkpoint can be superseded after the seek landed.
            const current = playbackStore.getState();
            const bounded = Math.max(
              0,
              Math.min(
                positionMs,
                start.durationMs > 0 ? start.durationMs : positionMs,
              ),
            );
            const moved =
              current.positionMs !== start.positionMs ||
              current.positionUpdatedAtMs !== start.positionUpdatedAtMs;
            if (
              getPlaybackErrorPresentation(error) ||
              !samePlayback() ||
              !moved ||
              Math.abs(current.positionMs - bounded) > 250
            )
              throw error;
          }
          if (!samePlayback()) return false;
          if (
            !wasPlaying &&
            playbackStore.getState().playbackState === "playing"
          ) {
            await playerService.pause();
          }
          if (!samePlayback()) return false;
          onSeek();
          return true;
        } catch (error) {
          const feedback = getPlaybackErrorPresentation(error);
          if (samePlayback() && feedback)
            toast.error(feedback.title, {
              description: feedback.description,
            });
          return false;
        } finally {
          pending.current = false;
          if (mounted.current) setIsSeeking(false);
        }
      };

      dismissNotice();
      if (!(await apply(targetMs))) return false;
      const expiresAt = Date.now() + 10_000;
      let used = false;
      // Sonner remembers dismissed ids and refuses to create them again.
      noticeId.current = `${toastId}-${request}`;
      toast.info("Listening position changed", {
        id: noticeId.current,

        duration: 10_000,
        action: {
          label: "Go back",
          onClick: () => {
            if (
              used ||
              pending.current ||
              Date.now() >= expiresAt ||
              !samePlayback()
            )
              return;
            used = true;
            dismissNotice();
            void apply(previousMs);
          },
        },
      });
      return true;
    },
    [bookId, dismissNotice, onSeek, toastId],
  );

  return { seek, isSeeking };
};
