import { Button, Divider, Host, Image, List, Menu, Picker, Section, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  foregroundStyle,
  labelStyle,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";

const noop = () => undefined;

export default function MenuScreen() {
  const [selectedIndex, setSelectedIndex] = React.useState<number | undefined>(1);

  return (
    <Host style={{ flex: 1 }}>
      <List>
        <Section title="Simple text label">
          <Menu label="Options">
            <Button onPress={noop} label="Option 1" />
            <Button onPress={noop} label="Option 2" />
            <Button onPress={noop} label="Option 3" />
          </Menu>
        </Section>

        <Section title="Text label with SF Symbol">
          <Menu label="More" systemImage="ellipsis.circle">
            <Button systemImage="gear" onPress={noop} label="Settings" />
            <Button systemImage="person" onPress={noop} label="Profile" />
            <Divider />
            <Button role="destructive" systemImage="trash" onPress={noop} label="Delete" />
          </Menu>
        </Section>

        <Section title="Custom label">
          <Menu label={<Text modifiers={[foregroundStyle("accentColor")]}>Custom Label</Text>}>
            <Button onPress={noop} label="Action 1" />
            <Button onPress={noop} label="Action 2" />
          </Menu>
        </Section>

        <Section title="Menu with Picker">
          <Menu label="Select Option" systemImage="list.bullet">
            <Picker
              label="Choose"
              modifiers={[pickerStyle("menu")]}
              selection={selectedIndex}
              onSelectionChange={setSelectedIndex}
            >
              {["First", "Second", "Third", "Fourth"].map((option, index) => (
                <Text key={index} modifiers={[tag(index)]}>
                  {option}
                </Text>
              ))}
            </Picker>
            <Divider />
            <Button onPress={noop} label="Confirm Selection" />
          </Menu>
        </Section>

        <Section title="Nested Menu">
          <Menu label="Main Menu">
            <Button onPress={noop} label="Item 1" />
            <Menu label="Submenu">
              <Button onPress={noop} label="Sub Item 1" />
              <Button onPress={noop} label="Sub Item 2" />
            </Menu>
            <Button onPress={noop} label="Item 2" />
          </Menu>
        </Section>

        <Section title="Menu with modifiers">
          <Menu label="Styled Menu" modifiers={[buttonStyle("borderedProminent")]}>
            <Button onPress={noop} label="Styled Action 1" />
            <Button onPress={noop} label="Styled Action 2" />
          </Menu>
        </Section>

        <Section title="Menu with primary action">
          <Menu label="Tap or Hold" systemImage="play.circle" onPrimaryAction={noop}>
            <Button onPress={noop} label="Menu Item 1" />
            <Button onPress={noop} label="Menu Item 2" />
            <Button onPress={noop} label="Menu Item 3" />
          </Menu>
        </Section>

        <Section title="Menu with glass button">
          <Menu label="Glass Button" modifiers={[buttonStyle("glass")]}>
            <Button onPress={noop} label="Menu Item 1" />
            <Button onPress={noop} label="Menu Item 2" />
            <Button onPress={noop} label="Menu Item 3" />
          </Menu>
        </Section>

        <Section title="Menu with Icon Only Button">
          <Menu label="Icon Only Button" modifiers={[labelStyle("iconOnly")]} systemImage="gear">
            <Button onPress={noop} label="Menu Item 1" />
            <Button onPress={noop} label="Menu Item 2" />
            <Button onPress={noop} label="Menu Item 3" />
          </Menu>
        </Section>

        <Section title="Apple Music-style Menu">
          <Menu label="Song Options" systemImage="ellipsis.circle">
            <Section>
              <Button systemImage="plus" label="Add" onPress={noop} />
              <Button systemImage="star" label="Favorite" onPress={noop} />
              <Button systemImage="square.and.arrow.up" label="Share" onPress={noop} />
            </Section>
            <Section>
              <Button systemImage="text.badge.plus" label="Add to a Playlist" onPress={noop} />
              <Button
                systemImage="antenna.radiowaves.left.and.right"
                label="Create Station"
                onPress={noop}
              />
            </Section>
            <Section>
              <Button onPress={noop}>
                <Image systemName="square.stack" />
                <Text>Go to Album</Text>
                <Text>Atado a Tu Amor</Text>
              </Button>
              <Button onPress={noop}>
                <Image systemName="mic" />
                <Text>Go to Artist</Text>
                <Text>Chayanne</Text>
              </Button>
            </Section>
            <Section>
              <Button systemImage="info.circle" label="View Credits" onPress={noop} />
              <Button systemImage="quote.bubble" label="Share Lyrics" onPress={noop} />
            </Section>
            <Button systemImage="hand.thumbsdown" label="Suggest Less" onPress={noop} />
          </Menu>
        </Section>
      </List>
    </Host>
  );
}

MenuScreen.navigationOptions = {
  title: "Menu",
};
