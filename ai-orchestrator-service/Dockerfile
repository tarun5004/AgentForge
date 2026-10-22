FROM node:22-alpine

WORKDIR /app

# Match the shared lockfile's workspace layout without copying secrets or source yet.
COPY package.json package-lock.json ./
COPY auth-service/package.json ./auth-service/package.json
COPY project-service/package.json ./project-service/package.json
COPY ai-orchestrator-service/package.json ./ai-orchestrator-service/package.json
COPY execution-service/package.json ./execution-service/package.json
COPY nextjs-boilerplate/package.json ./nextjs-boilerplate/package.json

RUN npm ci --workspace ai-orchestrator-service

COPY ai-orchestrator-service ./ai-orchestrator-service
WORKDIR /app/ai-orchestrator-service

USER node
EXPOSE 6001

# Local development only; credentials arrive at runtime, never during the build.
CMD ["npm", "run", "dev"]
