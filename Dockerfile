# Minimal image for running the TNL MCP server (tnl-mcp-server).
# Used by Glama (https://glama.ai/mcp/servers) to verify the server starts
# and responds to MCP introspection requests.

FROM node:20-alpine AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /build/package.json /build/package-lock.json ./
COPY --from=build /build/dist ./dist
RUN npm ci --omit=dev

ENTRYPOINT ["node", "/app/dist/mcp/server.js"]
