FROM node:22-alpine

WORKDIR /app

# Shared lockfile aur workspace metadata installation ke liye chahiye.
COPY package.json package-lock.json ./
COPY auth-service/package.json ./auth-service/package.json
COPY project-service/package.json ./project-service/package.json
COPY ai-orchestrator-service/package.json ./ai-orchestrator-service/package.json
COPY execution-service/package.json ./execution-service/package.json
COPY nextjs-boilerplate/package.json ./nextjs-boilerplate/package.json

# Lockfile ke according Auth ki dependencies install karo.
RUN npm ci --workspace auth-service

# Source baad mein copy karne se dependency layer cache reuse hoti hai.
COPY auth-service ./auth-service

WORKDIR /app/auth-service

# Application ko root permissions ki zarurat nahi.
USER node

EXPOSE 4000

# Yeh local-development image hai, production image nahi.
CMD ["npm", "run", "dev"]