export type BookshelfKindTone = "derived" | "custom" | "playlist";

export type BookshelfSyncStatus = {
  label: "Missing" | "Unsynced" | "Pending";
  tone: "warning" | "error" | "pending";
};

export type BookshelfSettingsItem = {
  id: string;
  title: string;
  kindLabel: "Derived" | "Custom" | "Device-only" | "Playlist";
  kindTone: BookshelfKindTone;
  homeItemCount: number;
  isVisible: boolean;
  syncStatus: BookshelfSyncStatus | null;
};

export type SuppressedBookshelfSettingsItem = {
  id: string;
  title: string;
  subtitle: string;
};

export type BookshelvesSettingsController = {
  scopeKey: string | null;
  shelves: BookshelfSettingsItem[];
  suppressedShelves: SuppressedBookshelfSettingsItem[];
  createShelf: () => void;
  openEditor: (shelfId: string) => void;
  toggleVisibility: (shelfId: string, nextVisibility: boolean) => void;
  reorderShelves: (orderedShelfIds: string[]) => void;
  restoreSuppressedShelf: (shelfId: string) => void;
};

export type BookshelfEditorAction = {
  id: string;
  label: string;
  tone: "accent" | "playlist" | "destructive";
  onPress: () => void;
};

export type BookshelfEditorController = {
  status: "ready" | "missing";
  title: string;
  name: string;
  canRename: boolean;
  isVisible: boolean;
  homeItemCount: number;
  helpText: string;
  isCreateMode: boolean;
  actions: BookshelfEditorAction[];
  setName: (name: string) => void;
  setVisible: (isVisible: boolean) => void;
  decrementHomeItemCount: () => void;
  incrementHomeItemCount: () => void;
  done: () => void;
};
