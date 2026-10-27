// upload-init endpoint (thin; logic in lib/upload-handlers).
import { initHandler } from "../lib/upload-handlers.mts";

export default async function handler(req: Request): Promise<Response> {
  return initHandler(req);
}
