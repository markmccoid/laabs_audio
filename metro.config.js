const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = __dirname;
const audioProRoot = path.resolve(projectRoot, "../laabs-react-native-audio-pro");

const config = getDefaultConfig(projectRoot);

// Allow importing .m4b audiobook assets
config.resolver.assetExts = [...config.resolver.assetExts, "m4b"];

// Let Metro watch the local file:../ dependency.
config.watchFolders = [...(config.watchFolders || []), audioProRoot];

// Force peer deps used by the sibling package to resolve from this Expo app.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// Make sure Metro checks the app's node_modules while resolving from the sibling package.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(audioProRoot, "node_modules"),
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
