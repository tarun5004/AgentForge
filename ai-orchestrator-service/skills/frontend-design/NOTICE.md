# Third-party source and modifications

Adapted from Anthropic's `frontend-design` skill.

- Repository: https://github.com/anthropics/skills
- Pinned revision: `dbd4588f9e1033efb41dad4bef2f7947c8993d44`
- Original: https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md
- Original UTF-8 SHA-256: `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`
- License: Apache-2.0, included verbatim in LICENSE.txt from the same revision.
- Reviewed/adapted: 2026-10-25.

SKILL.md is MODIFIED, not the original upstream file. AgentForge condenses the design/copy/accessibility guidance and replaces broad design-studio workflow with a small frontend-only generation policy. External fonts/assets/packages, extra approval conversations, tool acquisition, screenshots and speculative execution claims are excluded. Small tasks and targeted follow-ups remain small. The adaptation is not endorsed by Anthropic.

Runtime uses only this reviewed local copy, never the current GitHub main branch. Source/license review does not establish model quality or sandbox security.

2026-10-29 adaptation update: guidance now explicitly covers websites as well as small components.
The output instruction follows the connected workflow's supplied JSON schema (plan, complete file,
or repair manifest). The unconnected streaming experiment was removed during simplification.
Original attribution/license, frontend-only restrictions and tamper validation are unchanged.
