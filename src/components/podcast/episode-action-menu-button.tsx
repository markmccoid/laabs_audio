import type { ResolvedEpisodeAction } from "@/components/podcast/episode-action-menu";
import { formatEpisodeMenuTitle } from "@/podcast/episode-menu-title";
import { Button, Host, Menu, Section } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, labelStyle } from "@expo/ui/swift-ui/modifiers";
import type { SFSymbols7_0 } from "sf-symbols-typescript";

type EpisodeActionMenuButtonProps = {
  title?: string;
  actions: readonly ResolvedEpisodeAction[];
  systemImage?: SFSymbols7_0;
};

export const EpisodeActionMenuButton = ({
  title,
  actions,
  systemImage = "ellipsis",
}: EpisodeActionMenuButtonProps) => {
  const buttons = actions
    .filter((action) => action.visible)
    .map((action) => (
      <Button
        key={action.id}
        label={action.label}
        systemImage={action.systemImage}
        modifiers={[disabled(action.disabled)]}
        onPress={() => {
          void action.onPress?.();
        }}
      />
    ));
  const menuTitle = formatEpisodeMenuTitle(title);

  return (
    <Host matchContents>
      <Menu
        label="Episode actions"
        systemImage={systemImage}
        modifiers={[buttonStyle("glass"), labelStyle("iconOnly")]}
      >
        {menuTitle ? <Section title={menuTitle}>{buttons}</Section> : buttons}
      </Menu>
    </Host>
  );
};
