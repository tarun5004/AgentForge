# Trusted dependencies are installed once, never from generated package.json files.
FROM node:22.23.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY auth-service/package.json ./auth-service/package.json
COPY project-service/package.json ./project-service/package.json
COPY ai-orchestrator-service/package.json ./ai-orchestrator-service/package.json
COPY execution-service/package.json ./execution-service/package.json
COPY nextjs-boilerplate/package.json ./nextjs-boilerplate/package.json
RUN npm ci --workspace nextjs-boilerplate --include-workspace-root=false --ignore-scripts \
    && (test -e node_modules/typescript || ln -s /app/nextjs-boilerplate/node_modules/typescript node_modules/typescript) \
    && npm cache clean --force
# npm may keep the frontend's Node types nested when another workspace uses a different version.
RUN test -e node_modules/@types/node || ln -s /app/nextjs-boilerplate/node_modules/@types/node node_modules/@types/node
COPY execution-service/preview/prepare.mjs execution-service/preview/export.mjs execution-service/preview/read-file.mjs execution-service/preview/read-input.mjs /runner/
ENV NEXT_TELEMETRY_DISABLED=1
USER node
# Code arrives later over stdin; this process holds no secrets and exposes no port.
CMD ["node", "-e", "setInterval(() => {}, 60000)"]
