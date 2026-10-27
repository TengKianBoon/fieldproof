// upload-complete endpoint (thin; logic in lib/upload-handlers).
import { completeHandler } from "../lib/upload-handlers.mts";

export default async function handler(req: Request): Promise<Response> {
  return completeHandler(req);
}
