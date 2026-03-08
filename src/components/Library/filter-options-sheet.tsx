import SegmentedControl from "@/shared/ui/organisms/segmented-control";
import type { FilterOperator } from "@/store/store-filters";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useUniwind } from "uniwind";

export type FilterSheetType = "genres" | "tags";

type FilterOptionsSheetProps = {
  type: FilterSheetType;
  options: string[];
  selectedValues: string[];
  operator: FilterOperator;
  onToggle: (value: string) => void;
  onOperatorChange: (operator: FilterOperator) => void;
  onClear: () => void;
  onClose: () => void;
};

export const FilterOptionsSheet = ({
  type,
  options,
  selectedValues,
  operator,
  onToggle,
  onOperatorChange,
  onClear,
  onClose,
}: FilterOptionsSheetProps) => {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const [searchValue, setSearchValue] = useState("");
  const title = type === "genres" ? "Genres" : "Tags";
  const currentOperatorIndex = operator === "and" ? 0 : 1;
  const segmentedPreset = theme === "dark" ? "dark" : "light";

  useEffect(() => {
    setSearchValue("");
  }, [type]);

  const filteredOptions = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return options.filter((option) => option.toLowerCase().includes(normalizedSearch));
  }, [options, searchValue]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg, minHeight: 0 }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <Text style={{ color: themeColors.text, fontWeight: "700", fontSize: 22 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: themeColors.accent, fontWeight: "600", fontSize: 16 }}>Done</Text>
          </Pressable>
        </View>

        <View className="flex-row  items-center justify-around">
          <TextInput
            value={searchValue}
            onChangeText={setSearchValue}
            placeholder={`Search ${title.toLowerCase()}`}
            placeholderTextColor={themeColors.textMuted}
            style={{
              flexGrow: 1,
              marginRight: 4,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 12,
              color: themeColors.text,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 16,
            }}
          />

          {/* <Text style={{ color: themeColors.textMuted, fontSize: 13, fontWeight: "600" }}>
              {operatorDescription}
            </Text> */}
          <View className="">
            <SegmentedControl
              currentIndex={currentOperatorIndex}
              onChange={(index) => onOperatorChange(index === 0 ? "and" : "or")}
              preset={segmentedPreset}
              paddingVertical={8}
              activeSegmentBackgroundColor={themeColors.accent}
              width={125}
            >
              <Text
                style={{
                  color:
                    currentOperatorIndex === 0
                      ? themeColors.accentForeground
                      : themeColors.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                AND
              </Text>
              <Text
                style={{
                  color:
                    currentOperatorIndex === 1
                      ? themeColors.accentForeground
                      : themeColors.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                OR
              </Text>
            </SegmentedControl>
          </View>
        </View>

        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {selectedValues.length} selected
          </Text>
          <Pressable onPress={onClear} disabled={selectedValues.length === 0} hitSlop={10}>
            <Text
              style={{
                color: selectedValues.length ? themeColors.accent : themeColors.textMuted,
                fontWeight: "600",
                fontSize: 14,
              }}
            >
              Clear
            </Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredOptions}
        style={{ flex: 1 }}
        keyExtractor={(item) => item}
        keyboardShouldPersistTaps="handled"
        // contentInsetAdjustmentBehavior="automatic"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: 6 }}
        renderItem={({ item }) => {
          const isSelected = selectedValues.includes(item);
          return (
            <Pressable
              onPress={() => onToggle(item)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: isSelected ? themeColors.accentForeground : "transparent",
              }}
            >
              <View
                style={{
                  width: 20,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isSelected ? (
                  <SymbolView name="checkmark" tintColor={themeColors.accent} size={16} />
                ) : null}
              </View>
              <Text style={{ color: themeColors.text, fontSize: 16, flex: 1 }}>{item}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: 16, paddingVertical: 20 }}>
            <Text style={{ color: themeColors.textMuted }}>
              No matching {title.toLowerCase()} found.
            </Text>
          </View>
        }
      />
    </View>
  );
};
