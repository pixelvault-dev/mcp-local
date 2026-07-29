import { z } from "zod";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { apiRequest } from "../client.js";
import { toolOk, toolError, toolFromError, type ToolResult } from "../result.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // keep in lockstep with @pixelvault/validation
const MAX_MB = MAX_FILE_SIZE / 1024 / 1024;

/** Common image extensions → MIME. The API re-detects via magic bytes; this is
 *  just so the multipart part carries a sensible type (and a nice filename). */
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export const uploadImageInputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Absolute or relative path to a LOCAL image file. The server reads the file " +
        "off disk and streams the bytes — nothing is base64-encoded into the model " +
        "context, so large files work. Provide exactly one of path, source_url, or data."
    ),
  source_url: z
    .string()
    .optional()
    .describe(
      "Public https URL of an image; the PixelVault API fetches and imports it. " +
        "Provide exactly one of path, source_url, or data."
    ),
  data: z
    .string()
    .optional()
    .describe(
      "Base64-encoded image bytes (data URLs accepted). Prefer `path` for local " +
        "files. Provide exactly one of path, source_url, or data."
    ),
  folder: z.string().optional().describe("Optional folder/path prefix for the image."),
  filename: z.string().optional().describe("Optional filename override, e.g. photo.png."),
  visibility: z
    .enum(["public", "private"])
    .optional()
    .describe("`private` returns a signed URL only link-holders can open. Defaults to public."),
  expires_in: z
    .number()
    .int()
    .min(60)
    .max(2592000)
    .optional()
    .describe(
      "Optional time-to-live in seconds (60–2,592,000, i.e. 1 min to 30 days). The " +
        "image is auto-deleted after this. Omit for a permanent image."
    ),
  sign_expires_in: z
    .number()
    .int()
    .min(60)
    .max(2592000)
    .optional()
    .describe("For visibility=private: signed-URL lifetime in seconds (default 3600)."),
};

interface UploadResult {
  data: { id: string; url: string; visibility?: "public" | "private"; [k: string]: unknown };
}

/**
 * upload_image — the reason this local server exists.
 *
 * `path` reads the file locally and POSTs it as multipart/form-data, so the raw
 * bytes never pass through the model as base64 (the failure mode that pushes
 * agents off a remote MCP for large local files). `source_url` forwards to the
 * API's URL-import (JSON `{ url }`); `data` decodes inline base64 for callers
 * that already hold bytes.
 */
export async function uploadImage(args: {
  path?: string;
  source_url?: string;
  data?: string;
  folder?: string;
  filename?: string;
  visibility?: "public" | "private";
  expires_in?: number;
  sign_expires_in?: number;
}): Promise<ToolResult> {
  const { path, source_url, data, folder, filename, visibility, expires_in, sign_expires_in } = args;

  const provided = [path, source_url, data].filter((v) => v !== undefined).length;
  if (provided !== 1) {
    return toolError("invalid_input", "Provide exactly one of path, source_url, or data.");
  }

  try {
    // URL import: let the API fetch it (it has its own SSRF guards + validation).
    if (source_url !== undefined) {
      const res = await apiRequest<UploadResult>({
        method: "POST",
        path: "/v1/images",
        body: {
          url: source_url,
          ...(folder !== undefined ? { folder } : {}),
          ...(visibility !== undefined ? { visibility } : {}),
          ...(expires_in !== undefined ? { expires_in } : {}),
          ...(sign_expires_in !== undefined ? { sign_expires_in } : {}),
        },
      });
      return finalize(res, visibility);
    }

    // Local file or inline base64 → multipart upload.
    let bytes: Uint8Array;
    let name: string;
    let contentType = "application/octet-stream";

    if (path !== undefined) {
      try {
        bytes = await readFile(path);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError("file_read_failed", `Could not read local file at "${path}": ${msg}`);
      }
      name = filename ?? basename(path);
      contentType = MIME_BY_EXT[extname(path).toLowerCase()] ?? contentType;
    } else {
      bytes = decodeBase64(data as string);
      name = filename ?? "image";
    }

    if (bytes.byteLength > MAX_FILE_SIZE) {
      return toolError(
        "file_too_large",
        `Image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_MB} MB.`
      );
    }

    const form = new FormData();
    // Copy into a standalone ArrayBuffer: Node's Buffer is backed by a shared
    // pool (ArrayBufferLike), which the DOM Blob typings reject, and slicing also
    // guarantees the part isn't a view into a reused buffer.
    const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.append("file", new Blob([part], { type: contentType }), name);
    if (folder !== undefined) form.append("folder", folder);
    if (visibility !== undefined) form.append("visibility", visibility);
    if (expires_in !== undefined) form.append("expires_in", String(expires_in));
    if (sign_expires_in !== undefined) form.append("sign_expires_in", String(sign_expires_in));

    const res = await apiRequest<UploadResult>({ method: "POST", path: "/v1/images", form });
    return finalize(res, visibility);
  } catch (err) {
    return toolFromError(err);
  }
}

/** Fail closed on private: never report a URL the caller would wrongly trust as private. */
function finalize(res: UploadResult, visibility?: "public" | "private"): ToolResult {
  if (visibility === "private" && res.data.visibility !== "private") {
    return toolError(
      "not_private",
      "Upload succeeded but the server did not confirm a private (signed) URL. Refusing to " +
        "report it as private. A private upload needs a secret key (pv_live_/pv_test_)."
    );
  }
  return toolOk(res.data);
}

function decodeBase64(input: string): Uint8Array {
  const comma = input.indexOf(",");
  const b64 = input.startsWith("data:") && comma !== -1 ? input.slice(comma + 1) : input;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
