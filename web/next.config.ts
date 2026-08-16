import type { NextConfig } from "next";

const config: NextConfig = {
  // `shared/` ships raw TypeScript rather than a build step, so Next has to
  // compile it like first-party code.
  transpilePackages: ["@auravis/shared"],

  webpack: (config) => {
    // ESM requires explicit file extensions, so shared/src imports its own
    // modules as "./intent.js" even though the file on disk is intent.ts.
    // tsc understands that convention; webpack does not, and fails the
    // production build with "Can't resolve './intent.js'" while dev mode
    // happily carries on. This teaches it the same mapping.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default config;
