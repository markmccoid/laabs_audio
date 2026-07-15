import type { LibraryItemSummary } from "@/api/library-items-api";
import type { ShelfMembershipOption } from "@/hooks/use-shelf-membership-options";
import type { SFSymbols7_0 } from "sf-symbols-typescript";

export type BookActionId =
  | "playPause"
  | "bookshelves"
  | "favorite"
  | "readUnread"
  | "share"
  | "viewAuthor"
  | "continueListeningVisibility";

export const LIBRARY_BOOK_ACTIONS = [
  "playPause",
  "bookshelves",
  "favorite",
  "readUnread",
  "share",
] as const satisfies readonly BookActionId[];

export const HOME_BOOK_ACTIONS = [
  "playPause",
  "bookshelves",
  "favorite",
  "readUnread",
  "share",
  "continueListeningVisibility",
] as const satisfies readonly BookActionId[];

export type BookActionContext = {
  book: LibraryItemSummary;
};

export type BookActionHandler = (context: BookActionContext) => void | Promise<void>;

export type BookActionHandlers = {
  viewAuthor?: BookActionHandler;
};

export type ResolvedBookAction = {
  id: BookActionId;
  label: string;
  systemImage?: SFSymbols7_0;
  visible: boolean;
  disabled: boolean;
  onPress?: () => void | Promise<void>;
  shelfOptions?: readonly ShelfMembershipOption[];
  onSelectShelfOption?: (option: ShelfMembershipOption) => void | Promise<void>;
};
