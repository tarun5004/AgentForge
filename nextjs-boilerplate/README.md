# AgentForge Frontend

This Next.js application provides AgentForge's authentication screens and Cursor-inspired AI development workspace.

## Local development

Copy the environment example:

```powershell
Copy-Item .env.example .env.local
```

Start the frontend on `http://localhost:3001`:

```bash
npm run dev
```

The Auth Service must be running at the `AUTH_SERVICE_URL` configured in `.env.local`.

## Authentication flow

```text
Browser /api/auth request
        |
        v
Next.js same-origin rewrite
        |
        v
Independent Auth Service
```

The access token is kept in React memory. The refresh token is set and rotated by the Auth Service as an HttpOnly cookie, so frontend JavaScript cannot read it.
