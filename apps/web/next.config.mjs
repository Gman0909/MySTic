/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@mystic/core"],
  devIndicators: false,
  webpack: (config) => {
    // @mystic/core is TS source using ESM ".js" import specifiers — map them to .ts.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
