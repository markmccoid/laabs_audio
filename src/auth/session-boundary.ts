import { playerService } from "../player/player-service";
import { queryClient } from "../query/query-client";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { libraryActivationStore } from "./library-activation-store";

export const prepareForUserSessionBoundary = async () => {
  await playerService.endActivePlaybackForLogout().catch((error) => {
    if (__DEV__) {
      console.warn("[session-boundary] player-teardown-failed", { error });
    }
  });
  libraryActivationStore.getState().actions.clear();
  await clearSessionQueryCache(queryClient);
};
