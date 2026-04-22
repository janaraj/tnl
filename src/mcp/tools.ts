export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<McpToolResult> | McpToolResult;
}

export const mcpTools: Map<string, McpTool> = new Map();

export interface ListToolsResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

export function handleListTools(
  registry: Map<string, McpTool> = mcpTools,
): ListToolsResult {
  return {
    tools: Array.from(registry.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

export interface CallToolRequest {
  params: {
    name: string;
    arguments?: unknown;
  };
}

export async function handleCallTool(
  request: CallToolRequest,
  registry: Map<string, McpTool> = mcpTools,
): Promise<McpToolResult> {
  const tool = registry.get(request.params.name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  try {
    return await tool.handler(request.params.arguments);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
