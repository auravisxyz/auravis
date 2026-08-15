import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared package ships TypeScript source rather than a build artifact,
  // so Next has to compile it alongside the app.
  transpilePackages: ["@auravis/shared"],
};

export default config;
