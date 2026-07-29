import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve PixelVault credentials + base URL for the local MCP server.
 *
 * Precedence mirrors the PixelVault CLI so the two share one auth story:
 *   1. Environment variable (PIXELVAULT_API_KEY / PIXELVAULT_API_URL)
 *   2. ~/.pixelvault/config.json (written by `pixelvault login`/`register`)
 *   3. Built-in default (base URL only)
 *
 * A running MCP client (Claude Desktop, etc.) sets env vars per-server, so the
 * env path is the common case; the shared config file is a convenience for
 * users who already authenticated with the CLI.
 */

const CONFIG_FILE = join(homedir(), ".pixelvault", "config.json");
const DEFAULT_API_URL = "https://api.pixelvault.dev";

interface FileConfig {
  api_key?: string;
  api_url?: string;
}

function readFileConfig(): FileConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as FileConfig;
  } catch {
    return {};
  }
}

export function getApiKey(): string | undefined {
  return process.env["PIXELVAULT_API_KEY"] || readFileConfig().api_key;
}

export function getApiUrl(): string {
  return (
    process.env["PIXELVAULT_API_URL"] || readFileConfig().api_url || DEFAULT_API_URL
  );
}
