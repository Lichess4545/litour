import { openApiDocument } from "@/server/http/app";

process.stdout.write(JSON.stringify(openApiDocument(), null, 2));
