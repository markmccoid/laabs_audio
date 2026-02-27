import { useAuthStore } from "@/auth/auth-store";
import {
  type HomeCustomShelf,
  type HomePlaylistShelf,
  useHomeShelves,
} from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import {
  DEFAULT_HOME_SHELF_ITEM_COUNT,
  MAX_HOME_SHELF_ITEM_COUNT,
  MIN_HOME_SHELF_ITEM_COUNT,
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CountStepper } from "./count-stepper";

type EditorMode = "create" | "edit";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const isCustomShelf = (value: unknown): value is HomeCustomShelf =>
  Boolean(value) &&
  typeof value === "object" &&
  "kind" in (value as HomeCustomShelf) &&
  (value as HomeCustomShelf).kind === "custom";

const isPlaylistShelf = (value: unknown): value is HomePlaylistShelf =>
  Boolean(value) &&
  typeof value === "object" &&
  "kind" in (value as HomePlaylistShelf) &&
  (value as HomePlaylistShelf).kind === "playlist";

const Section = ({ children }: { children: React.ReactNode }) => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
};

const Row = ({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: React.ReactNode;
  isLast?: boolean;
}) => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: themeColors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <Text
        selectable
        style={{ color: themeColors.text, fontSize: 16, fontWeight: "500", flex: 1 }}
      >
        {label}
      </Text>
      {value}
    </View>
  );
};

export const BookshelfEditorSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    shelfId: shelfIdParamRaw,
    mode: modeParamRaw,
    shelfType: shelfTypeParamRaw,
  } = useLocalSearchParams<{
    shelfId?: string | string[];
    mode?: string | string[];
    shelfType?: string | string[];
  }>();
  const shelfId = resolveParam(shelfIdParamRaw) ?? null;
  const modeParam = resolveParam(modeParamRaw);
  const shelfTypeParam = resolveParam(shelfTypeParamRaw);
  const mode: EditorMode = modeParam === "create" ? "create" : "edit";
  const isCreateMode = mode === "create";
  const createShelfType = shelfTypeParam === "playlist" ? "playlist" : "custom";

  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const {
    addBooksToPlaylistShelfOptimistic,
    createPlaylistShelf,
    deleteCustomShelf,
    deletePlaylistShelfFromServer,
    renameCustomShelf,
    renamePlaylistShelfOptimistic,
    restoreSuppressedPlaylist,
    suppressPlaylistShelf,
  } = useDeviceBooksActions();
  const { setHomeShelfVisibility, setHomeShelfItemCount, setHomeShelfOrder, clearHomeShelf } =
    useSettingsActions();
  const { homeScopeKey, shelves } = useHomeShelves();
  const storedShelfOrder = useSettingsStore((state) =>
    homeScopeKey ? (state.homeShelvesByScope[homeScopeKey]?.shelfOrder ?? []) : [],
  );

  const shelf = useMemo(
    () => shelves.find((candidate) => candidate.id === shelfId) ?? null,
    [shelfId, shelves],
  );

  const [nameDraft, setNameDraft] = useState("");
  const [draftIsVisible, setDraftIsVisible] = useState(false);
  const [draftHomeItemCount, setDraftHomeItemCount] = useState(DEFAULT_HOME_SHELF_ITEM_COUNT);
  const committedRef = useRef(false);
  const isPlaylistCreateDraft = isCreateMode && createShelfType === "playlist" && !shelf;

  useEffect(() => {
    if (isPlaylistCreateDraft) {
      setNameDraft((current) => current || "New Shelf");
      return;
    }
    if (!shelf || (!isCustomShelf(shelf) && !isPlaylistShelf(shelf))) return;
    setNameDraft(shelf.title);
  }, [isPlaylistCreateDraft, shelf]);

  useEffect(() => {
    if (!shelf || (!isCustomShelf(shelf) && !isPlaylistShelf(shelf))) return;
    const nextName = nameDraft.trim();
    if (!nextName || nextName === shelf.title) return;

    if (!isCustomShelf(shelf)) return;

    const timer = setTimeout(() => {
      renameCustomShelf(shelf.id, nextName, {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      });
    }, 220);

    return () => clearTimeout(timer);
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    nameDraft,
    renameCustomShelf,
    shelf,
  ]);

  useEffect(() => {
    return () => {
      if (!isCreateMode || committedRef.current || !shelfId) return;
      if (!isCustomShelf(shelf)) return;

      deleteCustomShelf(shelfId, {
        userKey: activeLibraryUserKey,
        libraryId: activeLibraryId,
      });
      clearHomeShelf(homeScopeKey, shelfId);
    };
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    clearHomeShelf,
    deleteCustomShelf,
    homeScopeKey,
    isCreateMode,
    shelf,
    shelfId,
  ]);

  const handleDone = () => {
    void (async () => {
      committedRef.current = true;

      if (isPlaylistCreateDraft) {
        const createdName = nameDraft.trim() || "New Shelf";
        const createdShelfId = await createPlaylistShelf(
          { name: createdName },
          { userKey: activeLibraryUserKey, libraryId: activeLibraryId },
        );
        if (!createdShelfId) {
          committedRef.current = false;
          Alert.alert(
            "Unable to create playlist shelf",
            "Playlist shelves require an online authenticated session.",
          );
          return;
        }

        setHomeShelfVisibility(homeScopeKey, createdShelfId, draftIsVisible);
        setHomeShelfItemCount(homeScopeKey, createdShelfId, draftHomeItemCount);
        router.back();
        return;
      }

      if (shelf && isPlaylistShelf(shelf)) {
        const nextName = nameDraft.trim();
        if (nextName && nextName !== shelf.title) {
          void renamePlaylistShelfOptimistic(shelf.id, nextName, {
            userKey: activeLibraryUserKey,
            libraryId: activeLibraryId,
          });
        }
      }

      router.back();
    })();
  };

  const handleCancelNewShelf = () => {
    if (isPlaylistCreateDraft) {
      committedRef.current = true;
      router.back();
      return;
    }

    if (!shelfId || !isCustomShelf(shelf)) {
      handleDone();
      return;
    }
    committedRef.current = true;
    deleteCustomShelf(shelfId, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    clearHomeShelf(homeScopeKey, shelfId);
    router.back();
  };

  const handleDeleteCustomShelf = (customShelf: HomeCustomShelf) => {
    Alert.alert(
      "Delete bookshelf?",
      `Delete "${customShelf.title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCustomShelf(customShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            clearHomeShelf(homeScopeKey, customShelf.id);
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleRemovePlaylistFromApp = (playlistShelf: HomePlaylistShelf) => {
    Alert.alert(
      "Remove from app view?",
      `Hide "${playlistShelf.title}" from app views while keeping it on Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            suppressPlaylistShelf(playlistShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleDeletePlaylistFromAudiobookshelf = (playlistShelf: HomePlaylistShelf) => {
    Alert.alert(
      "Delete playlist?",
      `Delete "${playlistShelf.title}" from Audiobookshelf? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            clearHomeShelf(homeScopeKey, playlistShelf.id);
            void deletePlaylistShelfFromServer(playlistShelf.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            });
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleConvertToPlaylist = (customShelf: HomeCustomShelf) => {
    Alert.alert(
      "Convert to Playlist Shelf?",
      `Convert "${customShelf.title}" to a playlist synced with Audiobookshelf?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: () => {
            void (async () => {
              const newShelfId = await createPlaylistShelf(
                { name: customShelf.title },
                { userKey: activeLibraryUserKey, libraryId: activeLibraryId },
              );
              if (!newShelfId) {
                Alert.alert("Unable to convert", "Could not create playlist shelf.");
                return;
              }

              await addBooksToPlaylistShelfOptimistic(newShelfId, customShelf.bookIds, {
                userKey: activeLibraryUserKey,
                libraryId: activeLibraryId,
              });

              setHomeShelfVisibility(homeScopeKey, newShelfId, customShelf.isVisible);
              setHomeShelfItemCount(homeScopeKey, newShelfId, customShelf.homeItemCount);

              const remappedOrder = storedShelfOrder.includes(customShelf.id)
                ? storedShelfOrder.map((id) => (id === customShelf.id ? newShelfId : id))
                : [...storedShelfOrder, newShelfId];
              setHomeShelfOrder(homeScopeKey, remappedOrder);

              deleteCustomShelf(customShelf.id, {
                userKey: activeLibraryUserKey,
                libraryId: activeLibraryId,
              });
              clearHomeShelf(homeScopeKey, customShelf.id);

              router.replace({
                pathname: "/(tabs)/settings/bookshelf-editor",
                params: { shelfId: newShelfId, mode: "edit" },
              });
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const title = isCreateMode ? "New Bookshelf" : "Bookshelf";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      collapsable={false}
    >
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable onPress={handleDone} style={{ paddingHorizontal: 2, paddingVertical: 4 }}>
              <Text
                selectable
                style={{ color: themeColors.accent, fontSize: 17, fontWeight: "600" }}
              >
                Done
              </Text>
            </Pressable>
          ),
        }}
      />

      {!shelf && !isPlaylistCreateDraft ? (
        <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: "center", gap: 10 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
            Shelf not found
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={{
              alignSelf: "flex-start",
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: themeColors.accent,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text selectable style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
              Close
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: Math.max(26, insets.bottom + 16),
            gap: 14,
          }}
        >
          <Section>
            <Row
              label="Show on Home"
              value={
                <Switch
                  value={shelf ? shelf.isVisible : draftIsVisible}
                  onValueChange={(nextValue) => {
                    if (!shelf) {
                      if (isPlaylistCreateDraft) {
                        setDraftIsVisible(nextValue);
                      }
                      return;
                    }
                    if (isPlaylistShelf(shelf) && nextValue && shelf.isSuppressed) {
                      restoreSuppressedPlaylist(shelf.id, {
                        userKey: activeLibraryUserKey,
                        libraryId: activeLibraryId,
                      });
                    }
                    setHomeShelfVisibility(homeScopeKey, shelf.id, nextValue);
                  }}
                />
              }
            />
            <Row
              label="Home Items"
              isLast
              value={
                <CountStepper
                  value={shelf ? shelf.homeItemCount : draftHomeItemCount}
                  min={MIN_HOME_SHELF_ITEM_COUNT}
                  max={MAX_HOME_SHELF_ITEM_COUNT}
                  onDecrement={() => {
                    if (!shelf) {
                      if (isPlaylistCreateDraft) {
                        setDraftHomeItemCount((current) =>
                          Math.max(MIN_HOME_SHELF_ITEM_COUNT, current - 1),
                        );
                      }
                      return;
                    }
                    setHomeShelfItemCount(homeScopeKey, shelf.id, shelf.homeItemCount - 1);
                  }}
                  onIncrement={() => {
                    if (!shelf) {
                      if (isPlaylistCreateDraft) {
                        setDraftHomeItemCount((current) =>
                          Math.min(MAX_HOME_SHELF_ITEM_COUNT, current + 1),
                        );
                      }
                      return;
                    }
                    setHomeShelfItemCount(homeScopeKey, shelf.id, shelf.homeItemCount + 1);
                  }}
                />
              }
            />
          </Section>

          <Section>
            <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 8 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "500" }}>
                Name
              </Text>
              {isPlaylistCreateDraft || isCustomShelf(shelf) || isPlaylistShelf(shelf) ? (
                <TextInput
                  autoFocus={isCreateMode}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Bookshelf name"
                  placeholderTextColor={themeColors.textMuted}
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    color: themeColors.text,
                    fontSize: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                />
              ) : (
                <View
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    paddingHorizontal: 12,
                    justifyContent: "center",
                  }}
                >
                  <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
                    {shelf?.title ?? "Playlist Shelf"}
                  </Text>
                </View>
              )}
              <Text
                selectable
                style={{ color: themeColors.textMuted, fontSize: 12, marginBottom: 12 }}
              >
                {isPlaylistCreateDraft
                  ? 'Playlist shelf is created when "Done" is pressed.'
                  : isCustomShelf(shelf)
                  ? "Changes are saved automatically."
                  : isPlaylistShelf(shelf)
                    ? 'Name changes are saved when "Done" is pressed.'
                    : "Built-in shelves cannot be renamed or deleted."}
              </Text>
            </View>
          </Section>

          {isCustomShelf(shelf) ? (
            <View style={{ gap: 10 }}>
              {!isCreateMode ? (
                <Pressable
                  onPress={() => handleConvertToPlaylist(shelf)}
                  style={{
                    minHeight: 48,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.accent,
                    backgroundColor: themeColors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 12,
                  }}
                >
                  <Text
                    selectable
                    style={{ color: themeColors.accent, fontSize: 16, fontWeight: "600" }}
                  >
                    Convert to Playlist Shelf
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={isCreateMode ? handleCancelNewShelf : () => handleDeleteCustomShelf(shelf)}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: "#d32424",
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                }}
              >
                <Text selectable style={{ color: "#d32424", fontSize: 16, fontWeight: "600" }}>
                  {isCreateMode ? "Cancel New Shelf" : "Delete Bookshelf"}
                </Text>
              </Pressable>
            </View>
          ) : isPlaylistShelf(shelf) ? (
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => handleRemovePlaylistFromApp(shelf)}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.absGold,
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                }}
              >
                <Text
                  selectable
                  style={{ color: themeColors.absGold, fontSize: 16, fontWeight: "600" }}
                >
                  Remove from App View
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleDeletePlaylistFromAudiobookshelf(shelf)}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: "#d32424",
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                }}
              >
                <Text selectable style={{ color: "#d32424", fontSize: 16, fontWeight: "600" }}>
                  Delete from Audiobookshelf
                </Text>
              </Pressable>
            </View>
          ) : isPlaylistCreateDraft ? (
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={handleCancelNewShelf}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: "#d32424",
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                }}
              >
                <Text selectable style={{ color: "#d32424", fontSize: 16, fontWeight: "600" }}>
                  Cancel New Shelf
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
};
