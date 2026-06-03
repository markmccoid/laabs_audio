import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, labelStyle } from "@expo/ui/swift-ui/modifiers";
import {
  useShelfBookCardMenuActions,
  type ShelfBookCardMenuProps,
} from "./shelf-book-card-menu-shared";

export const ShelfBookCardMenu = (props: ShelfBookCardMenuProps) => {
  const {
    continueListeningVisibilityIcon,
    continueListeningVisibilityLabel,
    favoriteDisabled,
    favoriteLabel,
    favoriteSystemImage,
    finishedLabel,
    finishedSystemImage,
    hasContinueListeningVisibilityOption,
    hideDisabled,
    primaryDisabled,
    finishDisabled,
    shareDisabled,
    shareLabel,
    shareSystemImage,
    shelfDisabled,
    primaryLabel,
    primarySystemImage,
    handleShareBook,
    handleToggleShelfMembership,
    shelfMembershipOptions,
    handleToggleContinueListeningVisibility,
    handlePrimaryAction,
    handleToggleFavorite,
    handleToggleFinished,
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
          {shelfMembershipOptions.length > 0 ? (
            shelfMembershipOptions.map((option) => (
              <Button
                key={option.shelfId}
                modifiers={[disabled(shelfDisabled || !option.canMutate)]}
                systemImage={option.isMember ? "checkmark.circle.fill" : "circle"}
                onPress={() => {
                  void handleToggleShelfMembership(option);
                }}
                label={option.title}
              />
            ))
          ) : (
            <Button modifiers={[disabled(true)]} label="No shelves" />
          )}
        </Menu>
        <Button
          modifiers={[disabled(favoriteDisabled)]}
          systemImage={favoriteSystemImage}
          onPress={() => {
            void handleToggleFavorite();
          }}
          label={favoriteLabel}
        />
        <Button
          modifiers={[disabled(finishDisabled)]}
          systemImage={finishedSystemImage}
          onPress={() => {
            void handleToggleFinished();
          }}
          label={finishedLabel}
        />
        <Button
          modifiers={[disabled(shareDisabled)]}
          systemImage={shareSystemImage}
          onPress={() => {
            void handleShareBook();
          }}
          label={shareLabel}
        />
        {hasContinueListeningVisibilityOption ? (
          <Button
            modifiers={[disabled(hideDisabled)]}
            systemImage={continueListeningVisibilityIcon}
            onPress={() => {
              void handleToggleContinueListeningVisibility();
            }}
            label={continueListeningVisibilityLabel}
          />
        ) : null}
      </Menu>
    </Host>
  );
};
