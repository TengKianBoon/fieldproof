// export-pack endpoint (thin; logic in lib/export-state).
import { exportHandler } from "../lib/export-state.mts";

export default async function handler(req: Request): Promise<Response> {
  return exportHandler(req);
}
