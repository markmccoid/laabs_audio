const fs = require("fs");
const path = require("path");
const { withDangerousMod, withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

/**
 * CarPlay (audio) support — see docs/carplay-integration-plan.md.
 *
 * SDK 58 already puts the app on the UIScene life cycle: Expo's template declares a
 * UIApplicationSceneManifest whose phone role uses the generated `SceneDelegate`, which creates
 * the window and starts React Native. This plugin:
 *
 * - adds the CarPlay template scene role (CarPlaySceneDelegate, shipped inside the vendored
 *   react-native-audio-pro pod and referenced by plain ObjC runtime name) next to Expo's phone
 *   role, leaving the phone role as Expo generates it;
 * - replaces the generated SceneDelegate.swift with plugins/carplay/SceneDelegate.swift, which
 *   lets a CarPlay cold launch (no phone scene) start JS and hands that running root to the phone
 *   scene when the user opens the app.
 */
const SCENE_DELEGATE_SOURCE = path.join(__dirname, "carplay", "SceneDelegate.swift");

const CARPLAY_SCENE_ROLE = "CPTemplateApplicationSceneSessionRoleApplication";

const withCarPlaySceneManifest = (config) =>
  withInfoPlist(config, (config) => {
    const manifest = config.modResults.UIApplicationSceneManifest;
    const phoneRole = manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    if (!Array.isArray(phoneRole) || phoneRole.length === 0) {
      throw new Error(
        "with-carplay expected Expo's UIApplicationSceneManifest phone scene in Info.plist. " +
          "Check the SDK's iOS template before changing this plugin.",
      );
    }

    config.modResults.UIApplicationSceneManifest = {
      ...manifest,
      // Kept from the pre-SDK 58 CarPlay setup, which shipped with this value.
      UIApplicationSupportsMultipleScenes: true,
      UISceneConfigurations: {
        ...manifest.UISceneConfigurations,
        [CARPLAY_SCENE_ROLE]: [
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

const withCarPlaySceneDelegate = (config) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      const { platformProjectRoot, projectName } = config.modRequest;
      const target = path.join(platformProjectRoot, projectName, "SceneDelegate.swift");
      if (!fs.existsSync(target)) {
        throw new Error(
          `with-carplay could not find Expo's generated SceneDelegate.swift at ${target}.`,
        );
      }
      fs.copyFileSync(SCENE_DELEGATE_SOURCE, target);
      return config;
    },
  ]);

const withCarPlay = (config) => {
  config = withCarPlaySceneManifest(config);
  config = withCarPlaySceneDelegate(config);

  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.carplay-audio"] = true;
    return config;
  });

  return config;
};

module.exports = withCarPlay;
