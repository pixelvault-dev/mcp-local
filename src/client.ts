import { getApiKey, getApiUrl } from "./config.js";

/** A PixelVault API error surfaced with its machine-readable code intact. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

interface RequestOptions {
  method?: string;
  path: string;
  /** JSON body (mutually exclusive with `form`). */
  body?: unknown;
  /** multipart/form-data body (mutually exclusive with `body`). */
  form?: FormData;
  /** Query-string params. */
  query?: Record<string, string | number | undefined>;
}

/**
 * Call the PixelVault API with the configured key as a Bearer token.
 *
 * Throws `ApiError` (code + message) on a non-2xx response so tools can map the
 * failure straight into a machine-readable MCP error result. The API's error
 * envelope is `{ error: { code, message } }`; we fall back to the HTTP status
 * when a body can't be parsed.
 */
export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ApiError(
      "missing_api_key",
      "No PixelVault API key. Set PIXELVAULT_API_KEY, or run `pixelvault login`/`register` in the CLI."
    );
  }

  let url = `${getApiUrl()}${options.path}`;
  if (options.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  let fetchBody: BodyInit | undefined;
  if (options.form) {
    fetchBody = options.form; // fetch sets the multipart boundary Content-Type
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: options.method || "GET", headers, body: fetchBody });
  } catch (err) {
    throw new ApiError(
      "network_error",
      err instanceof Error ? err.message : "Failed to reach the PixelVault API."
    );
  }

  if (!res.ok) {
    let parsed: ApiErrorBody | undefined;
    try {
      parsed = (await res.json()) as ApiErrorBody;
    } catch {
      /* body wasn't JSON */
    }
    throw new ApiError(
      parsed?.error?.code || "http_error",
      parsed?.error?.message || `HTTP ${res.status}: ${res.statusText}`
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
