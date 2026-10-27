// upload-chunk endpoint (thin; logic in lib/upload-handlers).
import { chunkHandler } from "../lib/upload-handlers.mts";

export default async function handler(req: Request): Promise<Response> {
  return chunkHandler(req);
}
