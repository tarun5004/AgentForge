// Reviewed local knowledge is data, not downloaded instructions or a permission to run tools.
export const frontendKnowledge = [
  { id: "portfolio", title: "Honest portfolio content", text: "Portfolio website: use supplied name, role, projects and contact details. If personal details are missing, ask one combined essential question or use clearly labelled placeholders when the user delegates defaults. Never invent employers, experience, testimonials or credentials." },
  { id: "accessibility", title: "Accessible frontend controls", text: "Accessibility: use semantic HTML, labelled forms, keyboard accessible buttons and links, visible focus, readable contrast and reduced motion. An interactive button must perform its stated action, not just look clickable." },
  { id: "responsive", title: "Responsive layout", text: "Responsive mobile layout: use fluid widths, grid or flex wrapping, small-screen spacing and readable typography. Avoid fixed page widths and horizontal overflow. Use plain CSS and no extra dependencies." },
  { id: "react-state", title: "Small React interactions", text: "React interactive state: add use client only where hooks or event handlers are required. Keep state local and components small. Handle empty, loading and error states. A frontend contact form may validate inputs locally but must not claim to send email without a backend." },
  { id: "editing", title: "Minimal selected-revision edits", text: "Follow-up edit: preserve the supplied selected revision and unrelated files. Change only what the user requested. Keep existing imports and behavior intact; deletion must be explicit. Do not claim code was built or previewed until actual execution reports success." },
  { id: "scope", title: "Local frontend runtime boundary", text: "Runtime scope: generated frontend uses Next.js App Router, React, TypeScript and plain CSS. No new packages, API routes, server actions, secret keys, arbitrary shell commands or backend services. Local Docker build and Preview are separate verified operations, not model capabilities." },
] as const;

// Tokenization builds sparse lexical vectors: inexpensive and explainable, but not neural embeddings.
function tokens(text: string): string[] {
  const ignored = new Set(["a", "an", "the", "is", "to", "for", "of", "and", "in", "it", "my", "me", "you", "i"]);
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 1 && !ignored.has(word));
}

// TF-IDF weights common corpus terms less; cosine ranks matches without a vector database service.
export function retrieveFrontendGuidance(query: string) {
  const documents = frontendKnowledge.map((source) => tokens(`${source.title} ${source.text}`));
  const queryTokens = tokens(query);
  const vocabulary = new Set(documents.flat());
  const weights = new Map([...vocabulary].map((term) => [term, 1 + Math.log((documents.length + 1) / (1 + documents.filter((words) => words.includes(term)).length))]));
  // Sparse maps need only corpus terms, so huge user vocabulary cannot expand stored vectors.
  const vector = (words: string[]) => {
    const result = new Map<string, number>();
    for (const term of words) if (weights.has(term)) result.set(term, (result.get(term) ?? 0) + weights.get(term)!);
    return result;
  };
  const queryVector = vector(queryTokens);
  const norm = (value: Map<string, number>) => Math.sqrt([...value.values()].reduce((sum, weight) => sum + weight * weight, 0));
  return frontendKnowledge.map((source, index) => {
    const document = vector(documents[index]!);
    const dot = [...queryVector].reduce((sum, [term, weight]) => sum + weight * (document.get(term) ?? 0), 0);
    return { ...source, score: dot / (norm(queryVector) * norm(document) || 1) };
  }).filter((source) => source.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 2);
}
