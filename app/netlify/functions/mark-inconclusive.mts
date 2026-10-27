// mark-inconclusive endpoint (thin; logic in lib/review-flow).
import { markInconclusiveHandler } from "../lib/review-flow.mts";

export default async function handler(req: Request): Promise<Response> {
  return markInconclusiveHandler(req);
}
