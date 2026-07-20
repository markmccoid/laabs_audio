export type ServerConnectionStatus = "unknown" | "reachable" | "unreachable";

export const isAudiobookshelfGatewayUnavailable = (status: number) =>
  status === 502 || status === 503 || status === 504;

export const canUseAudiobookshelfServer = (state: {
  isOnline: boolean | null;
  serverConnectionStatus: ServerConnectionStatus;
}) => state.isOnline !== false && state.serverConnectionStatus !== "unreachable";

export const isConnectionFailureKind = (kind: string) =>
  kind === "offline" || kind === "serverUnreachable";
