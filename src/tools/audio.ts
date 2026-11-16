import { createHash } from "node:crypto";
import { extname, basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolError, toolFromError, toolOk, type ToolResult } from "../result.js";

const AUDIO_MAX_BYTES = 25_000_000;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};
const visibility = z.enum(["public", "private"]).optional();
const metadata = z.record(z.string(), z.unknown()).optional();

export const uploadAudioInputSchema = {
  path: z
    .string()
    .optional()
    .describe("Path to a local MP3, WAV, M4A, or OGG. Provide exactly one of path or source_url. Originals are limited to the approved global maximum of 25,000,000 bytes."),
  source_url: z
    .string()
    .optional()
    .describe("Public HTTP(S) MP3, WAV, M4A, or OGG URL for secure server-side import. Provide exactly one of path or source_url."),
  filename: z.string().optional().describe("Original filename override. For URL imports, include a supported extension when the response MIME type is ambiguous."),
  visibility,
  expires_in: z.number().int().min(60).max(2_592_000).optional().describe("Asset deletion TTL in seconds. Omit for permanent storage."),
  sign_expires_in: z.number().int().min(60).max(2_592_000).optional().describe("Private URL lifetime in seconds."),
  folder: z.string().optional(),
  collection_id: z.string().optional(),
  metadata,
  idempotency_key: z
    .string()
    .min(1)
    .optional()
    .describe("Replay-safe upload key. Reuse only with identical input and lifecycle settings."),
};

export const listAudioInputSchema = {
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  folder: z.string().optional(),
  collection_id: z.string().optional(),
  metadata,
};

export const getAudioInputSchema = {
  id: z.string().describe("Stable audio asset ID (aud_...)."),
};

export const deleteAudioInputSchema = getAudioInputSchema;

export const updateAudioInputSchema = {
  id: z.string().describe("Stable audio asset ID (aud_...)."),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe("Replacement metadata; null clears it."),
  folder: z.string().nullable().optional().describe("Replacement folder; null clears it."),
  collection_id: z.string().nullable().optional().describe("Replacement collection membership; null clears it."),
};

export const signAudioUrlInputSchema = {
  id: z.string().describe("Stable private audio asset ID (aud_...)."),
  expires_in: z.number().int().min(60).max(2_592_000).optional(),
};

interface AudioAsset {
  id: string;
  visibility?: "public" | "private";
  original_url?: string;
  [key: string]: unknown;
}

interface DataResponse<T> {
  data: T;
}

interface UploadAudioArgs {
  path?: string;
  source_url?: string;
  filename?: string;
  visibility?: "public" | "private";
  expires_in?: number;
  sign_expires_in?: number;
  folder?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

function lifecycle(args: UploadAudioArgs): Record<string, unknown> {
  return {
    ...(args.visibility !== undefined ? { visibility: args.visibility } : {}),
    ...(args.expires_in !== undefined ? { expires_in: args.expires_in } : {}),
    ...(args.sign_expires_in !== undefined ? { sign_expires_in: args.sign_expires_in } : {}),
    ...(args.folder !== undefined ? { folder: args.folder } : {}),
    ...(args.collection_id !== undefined ? { collection_id: args.collection_id } : {}),
    ...(args.metadata && Object.keys(args.metadata).length > 0 ? { metadata: args.metadata } : {}),
  };
}

export async function uploadAudio(args: UploadAudioArgs): Promise<ToolResult> {
  if ((args.path === undefined) === (args.source_url === undefined)) {
    return toolError("invalid_input", "Provide exactly one of path or source_url.");
  }

  try {
    if (args.source_url !== undefined) {
      const response = await apiRequest<DataResponse<AudioAsset>>({
        method: "POST",
        path: "/v1/audio",
        headers: args.idempotency_key ? { "Idempotency-Key": args.idempotency_key } : undefined,
        body: {
          url: args.source_url,
          ...(args.filename !== undefined ? { filename: args.filename } : {}),
          ...lifecycle(args),
        },
      });
      return finalizeUpload(response.data, args.visibility);
    }

    const localPath = args.path as string;
    const info = await stat(localPath).catch((error: unknown) => {
      throw new Error(`Could not inspect local file at "${localPath}": ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!info.isFile()) return toolError("not_a_file", `Local path is not a regular file: ${localPath}`);
    if (info.size > AUDIO_MAX_BYTES) {
      return toolError(
        "audio_too_large",
        `Local audio is ${info.size.toLocaleString("en-US")} bytes. Audio originals are limited to the approved global maximum of 25,000,000 bytes; this is not a plan allowance.`,
      );
    }
    const filename = args.filename ?? basename(localPath);
    const contentType = CONTENT_TYPES[extname(filename).toLowerCase()];
    if (!contentType) {
      return toolError("unsupported_media_type", "Local audio filename must end in .mp3, .wav, .m4a, or .ogg.");
    }
    const bytes = await readFile(localPath);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "X-PixelVault-Filename": encodeURIComponent(filename),
    };
    if (args.visibility) headers["X-PixelVault-Visibility"] = args.visibility;
    if (args.expires_in !== undefined) headers["X-PixelVault-Expires-In"] = String(args.expires_in);
    if (args.sign_expires_in !== undefined) headers["X-PixelVault-Sign-Expires-In"] = String(args.sign_expires_in);
    if (args.folder) headers["X-PixelVault-Folder"] = args.folder;
    if (args.collection_id) headers["X-PixelVault-Collection-Id"] = args.collection_id;
    if (args.metadata && Object.keys(args.metadata).length > 0) {
      headers["X-PixelVault-Metadata"] = JSON.stringify(args.metadata);
    }
    if (args.idempotency_key) {
      headers["Idempotency-Key"] = args.idempotency_key;
      headers["X-PixelVault-Content-SHA256"] = createHash("sha256").update(bytes).digest("hex");
    }

    const response = await apiRequest<DataResponse<AudioAsset>>({
      method: "POST",
      path: "/v1/audio",
      headers,
      raw: bytes as unknown as BodyInit,
    });
    return finalizeUpload(response.data, args.visibility);
  } catch (error) {
    return toolFromError(error);
  }
}

function finalizeUpload(audio: AudioAsset, requestedVisibility?: "public" | "private"): ToolResult {
  if (requestedVisibility === "private" && audio.visibility !== "private") {
    return toolError("not_private", "The server did not confirm private storage; refusing to report this as a private upload.");
  }
  return toolOk(audio);
}

export async function listAudio(args: {
  page?: number;
  per_page?: number;
  folder?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<ToolResult> {
  try {
    const response = await apiRequest<{ data: AudioAsset[]; meta: Record<string, unknown> }>({
      path: "/v1/audio",
      query: {
        page: args.page,
        per_page: args.per_page,
        folder: args.folder,
        collection_id: args.collection_id,
        metadata: args.metadata && Object.keys(args.metadata).length > 0 ? JSON.stringify(args.metadata) : undefined,
      },
    });
    return toolOk(response);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function getAudio(args: { id: string }): Promise<ToolResult> {
  try {
    const response = await apiRequest<DataResponse<AudioAsset>>({ path: `/v1/audio/${encodeURIComponent(args.id)}` });
    return toolOk(response.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function updateAudio(args: {
  id: string;
  metadata?: Record<string, unknown> | null;
  folder?: string | null;
  collection_id?: string | null;
}): Promise<ToolResult> {
  try {
    const response = await apiRequest<DataResponse<AudioAsset>>({
      method: "PATCH",
      path: `/v1/audio/${encodeURIComponent(args.id)}`,
      body: {
        ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
        ...(args.folder !== undefined ? { folder: args.folder } : {}),
        ...(args.collection_id !== undefined ? { collection_id: args.collection_id } : {}),
      },
    });
    return toolOk(response.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function signAudioUrl(args: { id: string; expires_in?: number }): Promise<ToolResult> {
  try {
    const response = await apiRequest<DataResponse<Record<string, unknown>>>({
      method: "POST",
      path: `/v1/audio/${encodeURIComponent(args.id)}/sign-url`,
      body: args.expires_in === undefined ? {} : { expires_in: args.expires_in },
    });
    return toolOk(response.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function deleteAudio(args: { id: string }): Promise<ToolResult> {
  try {
    const response = await apiRequest<{ success: true }>({
      method: "DELETE",
      path: `/v1/audio/${encodeURIComponent(args.id)}`,
    });
    return toolOk(response);
  } catch (error) {
    return toolFromError(error);
  }
}
