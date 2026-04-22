#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult as SdkCallToolResult,
  type ListToolsResult as SdkListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { handleCallTool, handleListTools } from './tools.js';

// A3 + A4 + A5 tool modules are imported here for side-effect registration:
import './tools/get-impacted.js';
import './tools/retrieve.js';
import './tools/trace.js';
import './tools/propose.js';
import './tools/approve.js';
import './tools/verify.js';

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

const server = new Server(
  { name: 'tnl', version: readVersion() },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => handleListTools() as SdkListToolsResult,
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleCallTool({
    params: {
      name: request.params.name,
      arguments: request.params.arguments,
    },
  });
  return result as SdkCallToolResult;
});

const transport = new StdioServerTransport();
await server.connect(transport);
