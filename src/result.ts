import { ApiError } from "./client.js";

/**
 * Minimal MCP tool result shape (text content, optional error flag).
 * The index signature keeps it assignable to the SDK's `CallToolResult`.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Success result: the data serialized as pretty JSON text. */
export function toolOk(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Error result carrying a machine-readable code + message (so agents can branch). */
export function toolError(code: string, message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
  };
}

/** Map a thrown error (API or otherwise) to a tool error result. */
export function toolFromError(err: unknown): ToolResult {
  if (err instanceof ApiError) return toolError(err.code, err.message);
  return toolError("internal_error", err instanceof Error ? err.message : "Unknown error");
}
