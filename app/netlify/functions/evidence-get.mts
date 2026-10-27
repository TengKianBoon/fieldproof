// evidence-get endpoint (S2b): thin default-export wrapper, no /api path
// (the client calls /.netlify/functions names, as in F1).
import { evidenceHandler } from "../lib/evidence.mts";
import { blobsEndpoint } from "../lib/_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method" }), { status: 405 });
  return blobsEndpoint(req, evidenceHandler);
}
