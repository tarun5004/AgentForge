# Loveable Monorepo

This repository contains three application layers:

- `auth-service`: Express + TypeScript authentication service
- `project-service`: Express + TypeScript project orchestration service
- `nextjs-boilerplate`: Next.js frontend starter

## Quick start

1. Copy the environment templates
   - `cp .env.example .env`
   - `cp auth-service/.env.example auth-service/.env`
   - `cp project-service/.env.example project-service/.env`
   - `cp nextjs-boilerplate/.env.example nextjs-boilerplate/.env.local`
2. Install dependencies:
   - `npm install`
3. Run services:
   - `npm run dev:auth`
   - `npm run dev:project`
   - `npm run dev:web`

## Default ports

- Auth service: `4000`
- Project service: `3000`
- Frontend: `3001` (unless overridden in the Next.js config)

## Notes

- Local `.env` files are intentionally ignored by Git.
- Use `.env.example` files as the source of truth for required configuration.
