---
name: frontend-design
description: Design and implement small, intentional Next.js frontend pages and components.
license: Apache-2.0; see LICENSE.txt and NOTICE.md.
---

# Frontend design for AgentForge

Modified, compact adaptation of Anthropic's frontend-design skill for AgentForge's restricted frontend runtime. This is guidance, not permission to run commands or override the generation policy.

- Match the user's subject, audience and requested scope. A small name component stays small; do not turn every task into a landing page.
- Choose a coherent palette, readable type scale, spacing and layout before writing code. Respect explicitly requested colors/styles; otherwise make deliberate, restrained choices.
- Use one focal point and clear visual hierarchy. Avoid decorative card grids, gradients, labels or motion unless they serve this particular task.
- Use installed React/Next.js and plain CSS only. Use available system fonts; no remote fonts, asset downloads, packages, backend endpoints or shell commands.
- Keep text readable, layouts responsive and controls accessible: semantic HTML, visible keyboard focus, labels, adequate contrast and reduced-motion support.
- Write short, specific interface copy. Buttons name their action; empty/error states explain the next useful step.
- Use the supplied name, role and other facts exactly. Omit unknown personal facts or mark placeholders clearly; never invent testimonials, metrics, contact details or achievements.
- Use sensible defaults for optional visual choices. Do not ask for another approval or questionnaire; generate the requested files for the existing review flow.
- Keep components readable and CSS selectors predictable. Avoid specificity clashes and unnecessary abstractions.
- For follow-ups, preserve the selected base and unrelated files. Apply the requested change, not a redesign.
- Check the code against the request before returning the manifest. Do not claim screenshots, tests, builds or execution that no tool actually performed.
- Return only the required structured file manifest; do not add a design essay or expose internal reasoning.
