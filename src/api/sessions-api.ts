import { absClient, AbsApiError } from "./abs-client";

export type SessionSyncPayload = {
  timeListened: number;
  currentTime: number;
  duration?: number;
};

export type SessionSyncResult = {
  success: boolean;
  currentTime: number;
};

export const sessionsApi = {
  closeSession(sessionId: string, data: SessionSyncPayload) {
    return absClient.post<void>(`/api/session/${sessionId}/close`, data);
  },

  async syncSession(sessionId: string, data: SessionSyncPayload): Promise<SessionSyncResult> {
    try {
      await absClient.post<void>(`/api/session/${sessionId}/sync`, data);
      return { success: true, currentTime: data.currentTime };
    } catch (error) {
      if (error instanceof AbsApiError && error.status === 404) {
        console.warn(`Session ${sessionId} was already closed. Skipping sync.`);
        return { success: false, currentTime: data.currentTime };
      }
      console.error("Failed to sync progress:", error);
      throw error;
    }
  },
};
