import type { NextConfig } from "next";

const basePath = process.env["LITOUR_UI_BASE_PATH"];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath: basePath === undefined ? "/v2" : basePath,
};

export default nextConfig;
