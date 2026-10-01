import { toast } from "react-native-sonner";
import { getPlaybackErrorPresentation } from "./playback-error-presentation";

export const showPlaybackError = (error: unknown) => {
  if (error && typeof error === "object" && "suppressPlaybackPopup" in error &&
      error.suppressPlaybackPopup === true) return;
  const presentation = getPlaybackErrorPresentation(error);
  if (presentation) toast.error(presentation.title, { description: presentation.description });
};
