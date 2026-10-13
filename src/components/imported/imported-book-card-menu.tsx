import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { setImportedBookFinished } from "@/imported/imported-audiobook-library";
import { usePlaybackStore } from "@/player";
import { requestPlaybackToggleForIdentity } from "@/player/request-playback-toggle";
import { showPlaybackError } from "@/player/show-playback-error";
import { usePlaybackControls } from "@/player/use-playback-controls";
import {
  useHomeCardShelfMembershipOptions,
  useShelfMembershipContext,
} from "@/hooks/use-shelf-membership-options";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useImportedBooksStore } from "@/store/imported-books-store";
import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, labelStyle } from "@expo/ui/swift-ui/modifiers";
import { router } from "expo-router";
import { Alert } from "react-native";
import { confirmRemoveImportedAudiobook } from "./imported-audiobook-screen";

/**
 * Shelf card menu for an Imported Audiobook. Only local actions: no bookshelves, favorites, or
 * sharing, which belong to Audiobookshelf.
 */
export const ImportedBookCardMenu = ({
  book,
  progress,
}: {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
}) => {
  const isAudioPresent = useImportedBooksStore((state) =>
    Boolean(state.importedBooksById[book.id]?.audioPresent),
  );
  const isLoadedBook = usePlaybackStore((state) => state.libraryItemId === book.id);
  const { canToggle, action } = usePlaybackControls({ libraryItemId: book.id }, isAudioPresent);
  const isPlaying = action === "pause";
  const isFinished = Boolean(progress?.isFinished);
  const { activeLibraryId, activeLibraryUserKey } = useShelfMembershipContext();
  const { addBookToCustomShelf, removeBookFromCustomShelf } = useDeviceBooksActions();
  // Only Custom Shelves: Playlist Shelves are Audiobookshelf playlists and can't hold imported books.
  const customShelfOptions = useHomeCardShelfMembershipOptions(book.id).filter(
    (option) => option.kind === "custom",
  );

  const toggleShelf = (shelfId: string, isMember: boolean) => {
    const scope = { userKey: activeLibraryUserKey, libraryId: activeLibraryId };
    if (isMember) removeBookFromCustomShelf(shelfId, book.id, scope);
    else addBookToCustomShelf(shelfId, book.id, scope);
  };

  const togglePlayback = async () => {
    try {
      await requestPlaybackToggleForIdentity({ libraryItemId: book.id }, isAudioPresent);
    } catch (error) {
      showPlaybackError(error);
    }
  };

  const toggleFinished = () => {
    const title = isFinished ? "Mark as Unread" : "Mark as Read";
    const message = isFinished
      ? `Reset “${book.title}” to the beginning and mark it as unread?`
      : isLoadedBook
        ? `Stop playback, move “${book.title}” to the end, and mark it as finished?`
        : `Move “${book.title}” to the end and mark it as finished?`;
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: isFinished ? "Mark Unread" : "Mark Read",
        onPress: () =>
          void setImportedBookFinished(book.id, !isFinished).catch(() =>
            Alert.alert(isFinished ? "Unable to mark as unread" : "Unable to mark as read"),
          ),
      },
    ]);
  };

  return (
    <Host matchContents>
      <Menu
        label="Book actions"
        systemImage={isLoadedBook ? "waveform.low" : "ellipsis"}
        modifiers={[buttonStyle("glass"), labelStyle("iconOnly")]}
      >
        <Button
          modifiers={[disabled(!canToggle)]}
          systemImage={isPlaying ? "pause.fill" : "play.fill"}
          onPress={() => void togglePlayback()}
          label={isPlaying ? "Pause" : "Play"}
        />
        {/* Custom Shelves belong to a signed-in library, so there are none in signed-out modes. */}
        {customShelfOptions.length > 0 ? (
          <Menu label="Bookshelves" systemImage="books.vertical">
            {customShelfOptions.map((option) => (
              <Button
                key={option.shelfId}
                modifiers={[disabled(!option.canMutate)]}
                systemImage={option.isMember ? "checkmark.circle.fill" : "circle"}
                onPress={() => toggleShelf(option.shelfId, option.isMember)}
                label={option.title}
              />
            ))}
          </Menu>
        ) : null}
        <Button
          systemImage={isFinished ? "arrow.counterclockwise.circle" : "checkmark.circle"}
          onPress={toggleFinished}
          label={isFinished ? "Mark as Unread" : "Mark as Read"}
        />
        <Button
          systemImage="pencil"
          onPress={() =>
            router.push({ pathname: "/imported-book-edit", params: { libraryItemId: book.id } })
          }
          label="Edit Details"
        />
        <Button
          systemImage="trash"
          onPress={() => confirmRemoveImportedAudiobook(book.id, book.title)}
          label="Remove"
        />
      </Menu>
    </Host>
  );
};
