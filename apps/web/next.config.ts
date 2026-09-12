import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@ulpin/contracts"],
  serverExternalPackages: ["pg"],
  webpack(webpackConfig, { isServer }) {
    // The pinned production minifier corrupts Cesium's embedded WASM byte
    // strings into illegal octal template escapes. Preserve client source
    // bytes for this local demo; server optimization remains enabled.
    if (!isServer) webpackConfig.optimization.minimize = false;
    return webpackConfig;
  },
};
export default config;
