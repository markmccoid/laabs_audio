export type PlaybackErrorPresentation = { title: string; description: string };

export const getPlaybackErrorPresentation = (
  error: unknown,
): PlaybackErrorPresentation | null => {
  const record = error && typeof error === "object" ? error as {
    name?: string; message?: string; status?: number;
  } : undefined;
  const message = typeof error === "string" ? error : record?.message ?? "";
  if (record?.name === "PlaybackCancelledError" || /superseded|cancelled|canceled/i.test(message)) {
    return null;
  }
  if (record?.name === "AbsAuthRequiredError" || record?.status === 401 || record?.status === 403 ||
      /sign in|login required|log in|authentication|unauthenticated|unauthorized|token refresh/i.test(message)) {
    return { title: "Sign in to play", description: "Your server session needs attention. Sign in again, then tap Play." };
  }
  if (record?.name === "PlaybackStorageFailureError" || /checkpoint|protect Listening Position|storage|disk|persist|durab|native build|save.*position/i.test(message)) {
    return { title: "Unable to save listening progress", description: message || "Progress could not be saved. Try again when device storage is available." };
  }
  if (record?.name === "StreamedPlaybackStartFailureError" ||
      record?.name === "AbsOfflineError" || record?.name === "AbsServerUnavailableError" ||
      /stream|network|connection|audio.*load|load.*audio/i.test(message)) {
    return { title: "Couldn't load the audio", description: "Tap Play to try again. Check your connection and server, or download the audio to listen offline." };
  }
  return { title: "Playback needs attention", description: message || "Unable to complete playback. Tap Play to try again." };
};
