import {
  getRevenueCatTipPackages,
  isRevenueCatPurchaseCancellation,
  purchaseRevenueCatTip,
  type RevenueCatTipPackage,
} from "@/purchases/revenuecat";
import { useThemeColors } from "@/theme/use-app-theme";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";

type TipTierDefinition = {
  identifier: "small_tip" | "page_turner_tip" | "superfan_tip";
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof SymbolView>["name"];
};

const TIP_TIERS: TipTierDefinition[] = [
  {
    identifier: "small_tip",
    title: "Listener Tip",
    subtitle: "A kind gesture to support ongoing development and bug fixes",
    icon: "heart",
  },
  {
    identifier: "page_turner_tip",
    title: "Patron Tip",
    subtitle: "For those who spend hours lost in a good story.",
    icon: "book",
  },
  {
    identifier: "superfan_tip",
    title: "Audiophile Tip",
    subtitle: "Incredible support that directly fuels major new features.",
    icon: "star",
  },
];

const FEEDBACK_EMAIL_URL = "mailto:mccoidcoapps@gmail.com?subject=LAABS%20Audio%20Feedback";
const APP_STORE_REVIEW_URL = "itms-apps://itunes.apple.com/app/id6759327096?action=write-review";
const APP_STORE_WEB_URL = "https://apps.apple.com/app/id6759327096?action=write-review";

const normalizePackageIdentifier = (identifier: string) => identifier.replace(/^\$rc_custom_/, "");

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again in a moment.";

type ConnectRowProps = {
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof SymbolView>["name"];
  isLast?: boolean;
  onPress: () => void;
};

const ConnectRow = ({ title, subtitle, icon, isLast = false, onPress }: ConnectRowProps) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 70,
        paddingHorizontal: 14,
        paddingVertical: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: themeColors.border,
        opacity: pressed ? 0.74 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          borderCurve: "continuous",
          backgroundColor: themeColors.bg,
        }}
      >
        <SymbolView name={icon} size={19} tintColor={themeColors.accent} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          {title}
        </Text>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13, lineHeight: 18 }}>
          {subtitle}
        </Text>
      </View>
      <SymbolView name="arrow.up.right" size={14} tintColor={themeColors.textMuted} />
    </Pressable>
  );
};

export const SettingsSupportScreen = () => {
  const themeColors = useThemeColors();
  const [availablePackages, setAvailablePackages] = useState<RevenueCatTipPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [purchasingIdentifier, setPurchasingIdentifier] = useState<string | null>(null);

  const loadTipPackages = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      setAvailablePackages(await getRevenueCatTipPackages());
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void getRevenueCatTipPackages()
      .then((packages) => {
        if (isMounted) setAvailablePackages(packages);
      })
      .catch((error) => {
        if (isMounted) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const tiers = useMemo(
    () =>
      TIP_TIERS.map((definition) => ({
        definition,
        tipPackage: availablePackages.find(
          (candidate) => normalizePackageIdentifier(candidate.identifier) === definition.identifier,
        ),
      })),
    [availablePackages],
  );

  const handlePurchase = async (
    definition: TipTierDefinition,
    tipPackage: RevenueCatTipPackage,
  ) => {
    if (purchasingIdentifier) return;

    setPurchasingIdentifier(definition.identifier);

    try {
      await purchaseRevenueCatTip(tipPackage);

      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
      }

      Alert.alert(
        "Thank you!",
        "Your support furthers the development of LAABS Audio and is greatly appreciated.",
      );
    } catch (error) {
      if (!isRevenueCatPurchaseCancellation(error)) {
        Alert.alert("Tip not completed", getErrorMessage(error));
      }
    } finally {
      setPurchasingIdentifier(null);
    }
  };

  const handleSendFeedback = async () => {
    try {
      await Linking.openURL(FEEDBACK_EMAIL_URL);
    } catch {
      Alert.alert("Unable to open email", "You can reach us at mccoidcoapps@gmail.com.");
    }
  };

  const handleRateApp = async () => {
    try {
      await Linking.openURL(APP_STORE_REVIEW_URL);
    } catch {
      try {
        await Linking.openURL(APP_STORE_WEB_URL);
      } catch {
        Alert.alert("Unable to open the App Store", "Please try again later.");
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 36,
          gap: 22,
        }}
      >
        <View
          style={{
            paddingHorizontal: 20,
            paddingVertical: 24,
            gap: 14,
            alignItems: "center",
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 20,
            borderCurve: "continuous",
            backgroundColor: themeColors.surface,
          }}
        >
          <View
            style={{
              width: 58,
              height: 58,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 18,
              borderCurve: "continuous",
              backgroundColor: themeColors.accent,
            }}
          >
            <SymbolView name="heart.fill" size={28} tintColor={themeColors.accentForeground} />
          </View>
          <View style={{ gap: 7, alignItems: "center" }}>
            <Text
              selectable
              style={{
                color: themeColors.text,
                fontSize: 21,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              Keep the story going
            </Text>
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 15,
                lineHeight: 21,
                textAlign: "center",
              }}
            >
              Enjoying LAABS Audio? Your support helps further the development of the app!
            </Text>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Text
            selectable
            style={{
              color: themeColors.textMuted,
              fontSize: 12,
              fontWeight: "700",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              paddingHorizontal: 6,
            }}
          >
            Choose a tip
          </Text>

          {isLoading ? (
            <View
              style={{
                minHeight: 150,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
              }}
            >
              <ActivityIndicator color={themeColors.accent} />
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
                Loading tip options…
              </Text>
            </View>
          ) : loadError ? (
            <View
              style={{
                padding: 18,
                gap: 14,
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
              }}
            >
              <View style={{ gap: 5 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}
                >
                  Tips are temporarily unavailable
                </Text>
                <Text
                  selectable
                  style={{ color: themeColors.textMuted, fontSize: 14, lineHeight: 20 }}
                >
                  {loadError}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading tip options"
                onPress={() => void loadTipPackages()}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  borderRadius: 999,
                  backgroundColor: themeColors.accent,
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  opacity: pressed ? 0.78 : 1,
                })}
              >
                <Text
                  style={{
                    color: themeColors.accentForeground,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  Try Again
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={{
                overflow: "hidden",
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
              }}
            >
              {tiers.map(({ definition, tipPackage }, index) => {
                const isPurchasing = purchasingIdentifier === definition.identifier;
                const isDisabled = Boolean(purchasingIdentifier) || !tipPackage;

                return (
                  <Pressable
                    key={definition.identifier}
                    accessibilityRole="button"
                    accessibilityLabel={
                      tipPackage
                        ? `${definition.title}, ${tipPackage.product.priceString}`
                        : `${definition.title}, unavailable`
                    }
                    accessibilityHint="Completes an optional tip through the App Store"
                    disabled={isDisabled}
                    onPress={() => {
                      if (tipPackage) void handlePurchase(definition, tipPackage);
                    }}
                    style={({ pressed }) => ({
                      minHeight: 76,
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      borderBottomWidth: index === tiers.length - 1 ? 0 : 1,
                      borderBottomColor: themeColors.border,
                      opacity: isDisabled && !isPurchasing ? 0.48 : pressed ? 0.74 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 42,
                        height: 42,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 13,
                        borderCurve: "continuous",
                        backgroundColor: themeColors.bg,
                      }}
                    >
                      <SymbolView name={definition.icon} size={20} tintColor={themeColors.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text
                        selectable
                        style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}
                      >
                        {definition.title}
                      </Text>
                      <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                        {definition.subtitle}
                      </Text>
                    </View>
                    {isPurchasing ? (
                      <ActivityIndicator size="small" color={themeColors.accent} />
                    ) : (
                      <View
                        style={{
                          alignItems: "center",
                          gap: 2,
                          flexDirection: "row",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          selectable
                          style={{ color: themeColors.accent, fontSize: 16, fontWeight: "700" }}
                        >
                          {tipPackage?.product.priceString ?? "Unavailable"}
                        </Text>
                        <SymbolView
                          name="chevron.right"
                          size={12}
                          tintColor={themeColors.textMuted}
                        />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: themeColors.surface,
          }}
        >
          <SymbolView name="info.circle" size={18} tintColor={themeColors.textMuted} />
          <Text
            selectable
            style={{ flex: 1, color: themeColors.textMuted, fontSize: 13, lineHeight: 18 }}
          >
            Tips are optional but appreciated, processed securely by Apple, and do not unlock app
            features.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Text
            selectable
            style={{
              color: themeColors.textMuted,
              fontSize: 12,
              fontWeight: "700",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              paddingHorizontal: 6,
            }}
          >
            Connect
          </Text>
          <View
            style={{
              overflow: "hidden",
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 16,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
            }}
          >
            <ConnectRow
              title="Send Feedback"
              subtitle="Questions, ideas, and bug reports are welcome at mccoidcoapps@gmail.com"
              icon="envelope"
              onPress={() => void handleSendFeedback()}
            />
            <ConnectRow
              title="Rate LAABS Audio"
              subtitle="I hope you are enjoying the app. A rating helps other listeners find it and make me feel good (I hope!)."
              icon="star.bubble"
              isLast
              onPress={() => void handleRateApp()}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
};
