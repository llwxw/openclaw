import type { ChatRequest } from "./chat";
import type { ChatCompletion } from "./completions";

/**
 * Middleware function type for processing requests and responses (Onion Model)
 * Similar to Koa middleware, allows processing both before and after the next middleware
 */
export type Middleware = (
  req: ChatRequest,
  next: (req: ChatRequest) => Promise<ChatCompletion.ChatCompletion>
) => Promise<ChatCompletion.ChatCompletion>;
