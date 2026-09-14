/**
 * Ambient module declarations for static image imports (Metro's asset
 * pipeline handles the bundling; TS just needs to know the shape of the
 * default export). `expo-env.d.ts` is CLI-generated/gitignored, so this
 * lives here as a tracked, stable declaration file instead.
 */
declare module "*.png" {
  const value: import("react-native").ImageSourcePropType;
  export default value;
}

declare module "*.jpg" {
  const value: import("react-native").ImageSourcePropType;
  export default value;
}

declare module "*.jpeg" {
  const value: import("react-native").ImageSourcePropType;
  export default value;
}
