// finish-review endpoint (thin; logic in lib/review-flow).
import { finishReviewHandler } from "../lib/review-flow.mts";

export default async function handler(req: Request): Promise<Response> {
  return finishReviewHandler(req);
}
