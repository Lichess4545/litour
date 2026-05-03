import { createClient } from "@litour/api-client";

export type LitourClient = ReturnType<typeof createClient>;

export function serverApiBaseUrl(): string {
  const url = process.env["LITOUR_API_BASE_URL"];
  if (!url) {
    throw new Error("LITOUR_API_BASE_URL is not set");
  }
  return url;
}

export function publicApiBaseUrl(): string {
  const url = process.env["NEXT_PUBLIC_LITOUR_API_URL"];
  if (!url) {
    throw new Error("NEXT_PUBLIC_LITOUR_API_URL is not set");
  }
  return url;
}

export function serverClient(): LitourClient {
  return createClient(serverApiBaseUrl());
}
