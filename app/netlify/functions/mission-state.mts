// mission-state endpoint (thin; logic in lib/export-state).
import { stateHandler } from "../lib/export-state.mts";
import { blobsEndpoint } from "../lib/_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  return blobsEndpoint(req, stateHandler);
}
