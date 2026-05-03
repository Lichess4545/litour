import type { NextConfig } from "next";

// `frontend/ui/.env` is a symlink to the repo-root `.env` (created by
// devenv.nix `enterShell`), so Next.js's native loader picks up
// NEXT_PUBLIC_LITOUR_API_URL, LITOUR_API_BASE_URL, and LITOUR_UI_BASE_PATH
// without any per-package duplication.
const basePath = process.env["LITOUR_UI_BASE_PATH"];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath: basePath === undefined ? "/v2" : basePath,
};

export default nextConfig;
