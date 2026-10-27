// mission-state endpoint (thin; logic in lib/export-state).
import { stateHandler } from "../lib/export-state.mts";

export default async function handler(req: Request): Promise<Response> {
  return stateHandler(req);
}
