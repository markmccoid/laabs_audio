import { useAuthStore } from "../auth/auth-store";
import { selectHomeShelfScopeKey } from "../store/device-books-store";

/** The Home shelf scope for the current auth state (user+library, or the signed-out scope). */
export const useHomeShelfScopeKey = () => useAuthStore(selectHomeShelfScopeKey);
