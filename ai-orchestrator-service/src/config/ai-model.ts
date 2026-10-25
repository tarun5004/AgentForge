import { createGoogle } from "@ai-sdk/google";
import { gateway, type LanguageModel } from "ai";
import { env } from "./env.js";
import type { readAISettings } from "./ai-settings.js";

// Both workflows use the same SDK interface; only the connection changes, not business logic.
export function createAIModel(
  settings: ReturnType<typeof readAISettings> = env,
  fetcher?: typeof fetch,
): LanguageModel {
  if (settings.AI_PROVIDER === "google") {
    return createGoogle({
      apiKey: settings.GOOGLE_GENERATIVE_AI_API_KEY!,
      ...(fetcher ? { fetch: fetcher } : {}),
    })(settings.AI_MODEL);
  }
  return gateway(settings.AI_MODEL);
}

// Persist truthful connection metadata without changing the public response shape.
export const modelProvider = env.AI_PROVIDER === "google" ? "google" : "vercel-ai-gateway";
