const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

/**
 * CarPlay (audio) support — see docs/carplay-integration-plan.md.
 *
 * Adds a UIApplicationSceneManifest with two scene roles:
 * - the CarPlay template scene (CarPlaySceneDelegate), and
 * - a phone window scene (PhoneSceneDelegate).
 *
 * Declaring the manifest opts the app into the UIScene lifecycle, so the phone
 * UI needs a scene too — a CarPlay-only manifest leaves the RN window detached
 * (black screen; verified on iOS 26, Phase 0 spike). PhoneSceneDelegate is
 * deliberately minimal: Expo/RN startup still runs through the classic
 * AppDelegate; the scene delegate only adopts the already-created window and
 * forwards deep links.
 *
 * Both delegate classes ship inside the vendored react-native-audio-pro pod
 * and are referenced by plain ObjC runtime name, so no source files need to be
 * injected into the Xcode project.
 */
const withCarPlay = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: true,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneClassName: "UIWindowScene",
            UISceneConfigurationName: "Phone",
            UISceneDelegateClassName: "PhoneSceneDelegate",
          },
        ],
        CPTemplateApplicationSceneSessionRoleApplication: [
          {
            UISceneClassName: "CPTemplateApplicationScene",
            UISceneConfigurationName: "CarPlay",
            UISceneDelegateClassName: "CarPlaySceneDelegate",
          },
        ],
      },
    };
    return config;
  });

  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.carplay-audio"] = true;
    return config;
  });

  return config;
};

module.exports = withCarPlay;
