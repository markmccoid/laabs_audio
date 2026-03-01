import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, labelStyle } from "@expo/ui/swift-ui/modifiers";
import {
  useShelfBookCardMenuActions,
  type ShelfBookCardMenuProps,
} from "./shelf-book-card-menu-shared";

export const ShelfBookCardMenu = (props: ShelfBookCardMenuProps) => {
  const {
    addableShelves,
    continueListeningVisibilityLabel,
    hideDisabled,
    primaryDisabled,
    finishDisabled,
    shelfDisabled,
    primaryLabel,
    primarySystemImage,
    handleAddToShelf,
    handleToggleContinueListeningVisibility,
    handlePrimaryAction,
    handleMarkFinished,
  } = useShelfBookCardMenuActions(props);

  return (
    <Host matchContents>
      <Menu
        label="Book actions"
        systemImage="ellipsis"
        modifiers={[buttonStyle("glass"), labelStyle("iconOnly")]}
      >
        <Button
          modifiers={[disabled(primaryDisabled)]}
          systemImage={primarySystemImage}
          onPress={() => {
            void handlePrimaryAction();
          }}
          label={primaryLabel}
        />
        <Menu label="Bookshelves" systemImage="books.vertical">
          {addableShelves.length > 0 ? (
            addableShelves.map((shelf) => (
              <Button
                key={shelf.id}
                modifiers={[disabled(shelfDisabled)]}
                systemImage={shelf.kind === "custom" ? "books.vertical.fill" : "music.note.list"}
                onPress={() => {
                  void handleAddToShelf(shelf);
                }}
                label={shelf.title}
              />
            ))
          ) : (
            <Button modifiers={[disabled(true)]} label="No available shelves" />
          )}
        </Menu>
        <Button
          modifiers={[disabled(finishDisabled)]}
          systemImage="checkmark.circle"
          onPress={() => {
            void handleMarkFinished();
          }}
          label="Mark as Finished"
        />
        <Button
          modifiers={[disabled(hideDisabled)]}
          systemImage="eye.slash"
          onPress={() => {
            void handleToggleContinueListeningVisibility();
          }}
          label={continueListeningVisibilityLabel}
        />
      </Menu>
    </Host>
  );
};
