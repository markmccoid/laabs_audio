import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
} from "react-native-purchases";

const REVENUECAT_IOS_API_KEY = "appl_xBeYysDhZCesNxwlAjncFEgHaMS";

export const TIP_OFFERING_IDENTIFIER = "tips";

let isRevenueCatConfigured = false;

export const configureRevenueCat = () => {
  if (process.env.EXPO_OS !== "ios" || isRevenueCatConfigured) return;

  if (__DEV__) {
    void Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
  isRevenueCatConfigured = true;
};

const requireRevenueCat = () => {
  configureRevenueCat();

  if (!isRevenueCatConfigured) {
    throw new Error("Tips are available in the iOS app.");
  }
};

export type RevenueCatTipPackage = Awaited<
  ReturnType<typeof Purchases.getOfferings>
>["all"][string]["availablePackages"][number];

export const getRevenueCatTipPackages = async () => {
  requireRevenueCat();

  const offerings = await Purchases.getOfferings();
  const tipOffering = offerings.all[TIP_OFFERING_IDENTIFIER];

  if (!tipOffering) {
    throw new Error("The LAABS Audio tip offering is not available yet.");
  }

  return tipOffering.availablePackages;
};

export const purchaseRevenueCatTip = async (tipPackage: RevenueCatTipPackage) => {
  requireRevenueCat();
  return Purchases.purchasePackage(tipPackage);
};

export const isRevenueCatPurchaseCancellation = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const purchaseError = error as { code?: unknown; userCancelled?: unknown };
  return (
    purchaseError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR ||
    purchaseError.userCancelled === true
  );
};
