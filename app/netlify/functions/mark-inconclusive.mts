// mark-inconclusive endpoint (thin; logic in lib/review-flow).
import { markInconclusiveHandler } from "../lib/review-flow.mts";
import { blobsEndpoint } from "../lib/_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  return blobsEndpoint(req, markInconclusiveHandler);
}
