import type { ResolvedBookAction } from "@/components/books/book-action-types";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";

const SHELF_ACTION_PREFIX = "bookshelf:";

type BookActionMenuProps = {
  title?: string;
  actions: readonly ResolvedBookAction[];
  children: ReactNode;
  shouldOpenOnLongPress?: boolean;
  style?: StyleProp<ViewStyle>;
};

const toMenuAction = (action: ResolvedBookAction): MenuAction => {
  if (action.id === "bookshelves") {
    const shelfOptions = action.shelfOptions ?? [];

    return {
      id: action.id,
      title: action.label,
      image: action.systemImage,
      attributes: { disabled: action.disabled },
      subactions:
        shelfOptions.length > 0
          ? shelfOptions.map((option): MenuAction => ({
              id: `${SHELF_ACTION_PREFIX}${option.shelfId}`,
              title: option.title,
              image: option.isMember ? "checkmark.circle.fill" : "circle",
              attributes: { disabled: action.disabled || !option.canMutate },
            }))
          : [
              {
                id: `${SHELF_ACTION_PREFIX}none`,
                title: "No shelves",
                attributes: { disabled: true },
              },
            ],
    };
  }

  return {
    id: action.id,
    title: action.label,
    image: action.systemImage,
    attributes: { disabled: action.disabled },
  };
};

export const BookActionMenu = ({
  title,
  actions,
  children,
  shouldOpenOnLongPress = true,
  style,
}: BookActionMenuProps) => {
  const visibleActions = useMemo(() => actions.filter((action) => action.visible), [actions]);
  const menuActions = useMemo<MenuAction[]>(
    () => visibleActions.map(toMenuAction),
    [visibleActions],
  );

  const handlePressAction = ({ nativeEvent }: NativeActionEvent) => {
    const eventId = nativeEvent.event;

    if (eventId.startsWith(SHELF_ACTION_PREFIX)) {
      const shelfId = eventId.slice(SHELF_ACTION_PREFIX.length);
      const shelfAction = visibleActions.find((action) => action.id === "bookshelves");
      const shelfOption = shelfAction?.shelfOptions?.find((option) => option.shelfId === shelfId);
      if (!shelfAction || !shelfOption || shelfAction.disabled || !shelfOption.canMutate) return;

      void shelfAction.onSelectShelfOption?.(shelfOption);
      return;
    }

    const action = visibleActions.find((item) => item.id === eventId);
    if (!action || action.disabled) return;

    void action.onPress?.();
  };

  return (
    <MenuView
      title={title}
      actions={menuActions}
      shouldOpenOnLongPress={shouldOpenOnLongPress}
      onPressAction={handlePressAction}
      style={style}
    >
      {children}
    </MenuView>
  );
};
