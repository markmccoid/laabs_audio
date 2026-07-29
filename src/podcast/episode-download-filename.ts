const inferAudioExtension = (payload: {
  mimeType?: string | null;
  format?: string | null;
  codec?: string | null;
}) => {
  const mimeType = payload.mimeType?.trim().toLowerCase().split(";", 1)[0] ?? "";
  const format = payload.format?.trim().toLowerCase() ?? "";
  const codec = payload.codec?.trim().toLowerCase() ?? "";

  if (mimeType === "audio/mpeg" || mimeType === "audio/mp3" || format === "mp3") {
    return "mp3";
  }
  if (mimeType === "audio/x-m4b" || format.includes("m4b")) return "m4b";
  if (
    mimeType === "audio/mp4" ||
    mimeType === "audio/m4a" ||
    mimeType === "audio/x-m4a" ||
    format.includes("m4a")
  ) {
    return "m4a";
  }
  if (mimeType === "audio/flac" || format.includes("flac") || codec === "flac") return "flac";
  if (mimeType === "audio/ogg" || format.includes("ogg")) return "ogg";
  if (mimeType === "audio/opus" || format === "opus" || codec === "opus") return "opus";
  if (
    mimeType === "audio/wav" ||
    mimeType === "audio/wave" ||
    mimeType === "audio/x-wav" ||
    format.includes("wav")
  ) {
    return "wav";
  }
  if (mimeType === "audio/webm" || format.includes("webm")) return "webm";
  if (mimeType === "audio/aac" || format === "aac" || codec === "aac") return "aac";

  return "mp3";
};

export const resolveEpisodeDownloadFileName = (payload: {
  episodeId: string;
  mimeType?: string | null;
  format?: string | null;
  codec?: string | null;
}) => {
  const safeEpisodeId =
    payload.episodeId.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "episode";
  return `${safeEpisodeId}.${inferAudioExtension(payload)}`;
};
