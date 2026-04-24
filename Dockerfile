# Minimal image for running the TNL MCP server (tnl-mcp-server).
# Used by Glama (https://glama.ai/mcp/servers) to verify the server starts
# and responds to MCP introspection requests.

FROM node:20-alpine

RUN npm install -g typed-nl@latest

ENTRYPOINT ["tnl-mcp-server"]
