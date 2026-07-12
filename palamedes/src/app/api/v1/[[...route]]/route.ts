import { handle } from "hono/vercel";
import { api } from "@/server/http/app";

export const runtime = "nodejs";

export const GET = handle(api);
export const POST = handle(api);
