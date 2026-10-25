// Fail at startup for the selected provider only; never silently fall back to a paid connection.
export function readAISettings(source: NodeJS.ProcessEnv) {
  const provider = source.AI_PROVIDER?.trim() || "gateway";
  if (provider !== "gateway" && provider !== "google") {
    throw new Error("AI_PROVIDER must be gateway or google.");
  }

  const googleKey = source.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (provider === "google" && !googleKey) {
    throw new Error("Missing required environment variable: GOOGLE_GENERATIVE_AI_API_KEY");
  }
  if (provider === "gateway" && !source.AI_GATEWAY_API_KEY?.trim() && !source.VERCEL_OIDC_TOKEN?.trim()) {
    throw new Error("Missing AI Gateway authentication: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.");
  }

  const model = source.AI_MODEL?.trim() || (provider === "google" ? "gemini-3.5-flash-lite" : "google/gemini-2.5-flash");
  // Different ID formats prevent accidentally sending a Gateway slug to Google's API.
  const validModel = provider === "google"
    ? /^gemini-[a-zA-Z0-9._:-]+$/.test(model)
    : /^[a-z0-9-]+\/[a-zA-Z0-9._:-]+$/.test(model);
  if (model.length > 200 || !validModel) {
    throw new Error("AI_MODEL must match the selected provider: gemini-* for google, provider/model for gateway.");
  }

  return { AI_PROVIDER: provider, AI_MODEL: model, GOOGLE_GENERATIVE_AI_API_KEY: googleKey };
}
