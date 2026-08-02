import type { EpisodeActionEligibility } from "@/podcast/episode-action-eligibility";
import { formatEpisodeMenuTitle } from "@/podcast/episode-menu-title";
import {
  MenuView,
  type MenuAction,
  type NativeActionEvent,
} from "@expo/ui/community/menu";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { SFSymbols7_0 } from "sf-symbols-typescript";

export type ResolvedEpisodeAction = EpisodeActionEligibility & {
  systemImage?: SFSymbols7_0;
  onPress?: () => void | Promise<void>;
};

type EpisodeActionMenuProps = {
  title?: string;
  actions: readonly ResolvedEpisodeAction[];
  children: ReactNode;
  shouldOpenOnLongPress?: boolean;
  style?: StyleProp<ViewStyle>;
};

const toMenuAction = (action: ResolvedEpisodeAction): MenuAction => ({
  id: action.id,
  title: action.label,
  image: action.systemImage,
  attributes: { disabled: action.disabled },
});

export const EpisodeActionMenu = ({
  title,
  actions,
  children,
  shouldOpenOnLongPress = true,
  style,
}: EpisodeActionMenuProps) => {
  const visibleActions = actions.filter((action) => action.visible);
  const menuActions = visibleActions.map(toMenuAction);

  const handlePressAction = ({ nativeEvent }: NativeActionEvent) => {
    const action = visibleActions.find((item) => item.id === nativeEvent.event);
    if (!action || action.disabled) return;
    void action.onPress?.();
  };

  return (
    <MenuView
      title={formatEpisodeMenuTitle(title)}
      actions={menuActions}
      shouldOpenOnLongPress={shouldOpenOnLongPress}
      onPressAction={handlePressAction}
      style={style}
    >
      {children}
    </MenuView>
  );
};
