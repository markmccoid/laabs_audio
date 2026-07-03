// Custom entry: CarPlay must initialize at bundle-execution time — a cold
// launch from the car never mounts the React tree (see
// docs/carplay-integration-plan.md, gotcha #2). Keep this import first.
import "./src/carplay/carplay-init";
import "expo-router/entry";
