import { logStartupEvent, markStartup } from "./dev-startup-tracing";

type StartupPresentationListener = () => void;

export type StartupPresentationReason = "home-content" | "home-layout";

type StartupPresentationState = {
  hasPresentedInitialContent: boolean;
  reason: StartupPresentationReason | null;
};

const listeners = new Set<StartupPresentationListener>();

let state: StartupPresentationState = {
  hasPresentedInitialContent: false,
  reason: null,
};

export const getStartupPresentationState = () => state;

export const subscribeStartupPresentation = (listener: StartupPresentationListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const markStartupPresentation = (
  reason: StartupPresentationReason,
  payload?: Record<string, unknown>,
) => {
  if (state.hasPresentedInitialContent) {
    return false;
  }

  markStartup("first-content-painted");
  state = {
    hasPresentedInitialContent: true,
    reason,
  };

  logStartupEvent("first content painted", {
    reason,
    ...(payload ?? {}),
  });

  listeners.forEach((listener) => listener());
  return true;
};
