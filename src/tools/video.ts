import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolError, toolFromError, toolOk, type ToolResult } from "../result.js";

const DIRECT_MAX_BYTES = 100 * 1024 * 1024;
const visibility = z.enum(["public", "private"]).optional();
const metadata = z.record(z.string(), z.unknown()).optional();

export const uploadVideoInputSchema = {
  path: z
    .string()
    .optional()
    .describe("Path to a local MP4. Provide exactly one of path or source_url. Direct local uploads are limited to 100 MB."),
  source_url: z
    .string()
    .optional()
    .describe("Public HTTPS MP4 URL for secure server-side import. Provide exactly one of path or source_url."),
  filename: z.string().optional().describe("Original filename override. Defaults to the local basename or video.mp4."),
  visibility,
  expires_in: z.number().int().min(60).max(2_592_000).optional().describe("Asset deletion TTL in seconds. Omit for permanent storage."),
  sign_expires_in: z.number().int().min(60).max(2_592_000).optional().describe("Private URL lifetime in seconds."),
  folder: z.string().optional(),
  collection_id: z.string().optional(),
  metadata,
  social_ready: z.boolean().optional().describe("Start social-ready H.264/AAC fast-start optimization after upload."),
  idempotency_key: z
    .string()
    .min(1)
    .optional()
    .describe("Replay-safe upload key. Reuse only with identical input and lifecycle settings."),
};

export const listVideosInputSchema = {
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  folder: z.string().optional(),
  collection_id: z.string().optional(),
  metadata,
};

export const getVideoInputSchema = {
  id: z.string().describe("Stable video asset ID (vid_...)."),
};

export const deleteVideoInputSchema = getVideoInputSchema;

export const updateVideoInputSchema = {
  id: z.string().describe("Stable video asset ID (vid_...)."),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe("Replacement metadata; null clears it."),
  folder: z.string().nullable().optional().describe("Replacement folder; null clears it."),
  collection_id: z.string().nullable().optional().describe("Replacement collection membership; null clears it."),
};

export const signVideoUrlInputSchema = {
  id: z.string().describe("Stable private video asset ID (vid_...)."),
  expires_in: z.number().int().min(60).max(2_592_000).optional(),
};

const jobInputSchema = {
  id: z.string().describe("Stable video asset ID (vid_...)."),
  wait: z
    .boolean()
    .optional()
    .describe("Poll until terminal state. False returns asset/job IDs immediately for later resume with get_video."),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe("Local wait limit; timeout never cancels the server job. Default 600."),
};

export const optimizeVideoInputSchema = jobInputSchema;
export const enrichVideoInputSchema = jobInputSchema;

interface Video {
  id: string;
  visibility?: "public" | "private";
  original_url?: string;
  social_optimization?: { status?: string; job_id?: string; [key: string]: unknown };
  enrichment?: { status?: string; job_id?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface DataResponse<T> {
  data: T;
}

interface UploadVideoArgs {
  path?: string;
  source_url?: string;
  filename?: string;
  visibility?: "public" | "private";
  expires_in?: number;
  sign_expires_in?: number;
  folder?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
  social_ready?: boolean;
  idempotency_key?: string;
}

function lifecycle(args: UploadVideoArgs): Record<string, unknown> {
  return {
    ...(args.visibility !== undefined ? { visibility: args.visibility } : {}),
    ...(args.expires_in !== undefined ? { expires_in: args.expires_in } : {}),
    ...(args.sign_expires_in !== undefined ? { sign_expires_in: args.sign_expires_in } : {}),
    ...(args.folder !== undefined ? { folder: args.folder } : {}),
    ...(args.collection_id !== undefined ? { collection_id: args.collection_id } : {}),
    ...(args.metadata && Object.keys(args.metadata).length > 0 ? { metadata: args.metadata } : {}),
    ...(args.social_ready ? { social_ready: true } : {}),
  };
}

export async function uploadVideo(args: UploadVideoArgs): Promise<ToolResult> {
  if ((args.path === undefined) === (args.source_url === undefined)) {
    return toolError("invalid_input", "Provide exactly one of path or source_url.");
  }

  try {
    if (args.source_url !== undefined) {
      const res = await apiRequest<DataResponse<Video>>({
        method: "POST",
        path: "/v1/videos",
        headers: args.idempotency_key ? { "Idempotency-Key": args.idempotency_key } : undefined,
        body: {
          url: args.source_url,
          ...(args.filename !== undefined ? { filename: args.filename } : {}),
          ...lifecycle(args),
        },
      });
      return finalizeUpload(res.data, args.visibility);
    }

    const localPath = args.path as string;
    const info = await stat(localPath).catch((error: unknown) => {
      throw new Error(`Could not inspect local file at "${localPath}": ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!info.isFile()) return toolError("not_a_file", `Local path is not a regular file: ${localPath}`);
    if (info.size > DIRECT_MAX_BYTES) {
      return toolError(
        "multipart_required",
        `Local video is ${(info.size / 1024 / 1024).toFixed(1)} MB. upload_video supports the direct path up to 100 MB; use an official SDK's resumable upload for larger files.`,
      );
    }
    const bytes = await readFile(localPath);
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.byteLength),
      "X-PixelVault-Filename": encodeURIComponent(args.filename ?? basename(localPath)),
    };
    if (args.visibility) headers["X-PixelVault-Visibility"] = args.visibility;
    if (args.expires_in !== undefined) headers["X-PixelVault-Expires-In"] = String(args.expires_in);
    if (args.sign_expires_in !== undefined) headers["X-PixelVault-Sign-Expires-In"] = String(args.sign_expires_in);
    if (args.folder) headers["X-PixelVault-Folder"] = args.folder;
    if (args.collection_id) headers["X-PixelVault-Collection-Id"] = args.collection_id;
    if (args.metadata && Object.keys(args.metadata).length > 0) {
      headers["X-PixelVault-Metadata"] = JSON.stringify(args.metadata);
    }
    if (args.social_ready) headers["X-PixelVault-Social-Ready"] = "true";
    if (args.idempotency_key) {
      headers["Idempotency-Key"] = args.idempotency_key;
      headers["X-PixelVault-Content-SHA256"] = createHash("sha256").update(bytes).digest("hex");
    }

    const res = await apiRequest<DataResponse<Video>>({
      method: "POST",
      path: "/v1/videos",
      headers,
      raw: bytes as unknown as BodyInit,
    });
    return finalizeUpload(res.data, args.visibility);
  } catch (error) {
    return toolFromError(error);
  }
}

function finalizeUpload(video: Video, requestedVisibility?: "public" | "private"): ToolResult {
  if (requestedVisibility === "private" && video.visibility !== "private") {
    return toolError("not_private", "The server did not confirm private storage; refusing to report this as a private upload.");
  }
  return toolOk(video);
}

export async function listVideos(args: {
  page?: number;
  per_page?: number;
  folder?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<ToolResult> {
  try {
    const res = await apiRequest<{ data: Video[]; meta: Record<string, unknown> }>({
      path: "/v1/videos",
      query: {
        page: args.page,
        per_page: args.per_page,
        folder: args.folder,
        collection_id: args.collection_id,
        metadata: args.metadata && Object.keys(args.metadata).length > 0 ? JSON.stringify(args.metadata) : undefined,
      },
    });
    return toolOk(res);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function getVideo(args: { id: string }): Promise<ToolResult> {
  try {
    const res = await apiRequest<DataResponse<Video>>({ path: `/v1/videos/${encodeURIComponent(args.id)}` });
    return toolOk(res.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function deleteVideo(args: { id: string }): Promise<ToolResult> {
  try {
    const res = await apiRequest<{ success: true }>({
      method: "DELETE",
      path: `/v1/videos/${encodeURIComponent(args.id)}`,
    });
    return toolOk(res);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function updateVideo(args: {
  id: string;
  metadata?: Record<string, unknown> | null;
  folder?: string | null;
  collection_id?: string | null;
}): Promise<ToolResult> {
  try {
    const res = await apiRequest<DataResponse<Video>>({
      method: "PATCH",
      path: `/v1/videos/${encodeURIComponent(args.id)}`,
      body: {
        ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
        ...(args.folder !== undefined ? { folder: args.folder } : {}),
        ...(args.collection_id !== undefined ? { collection_id: args.collection_id } : {}),
      },
    });
    return toolOk(res.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function signVideoUrl(args: { id: string; expires_in?: number }): Promise<ToolResult> {
  try {
    const res = await apiRequest<DataResponse<Record<string, unknown>>>({
      method: "POST",
      path: `/v1/videos/${encodeURIComponent(args.id)}/sign-url`,
      body: args.expires_in === undefined ? {} : { expires_in: args.expires_in },
    });
    return toolOk(res.data);
  } catch (error) {
    return toolFromError(error);
  }
}

export async function optimizeVideo(args: {
  id: string;
  wait?: boolean;
  timeout_seconds?: number;
}): Promise<ToolResult> {
  return runVideoJob(args, "optimize", "social_optimization");
}

export async function enrichVideo(args: {
  id: string;
  wait?: boolean;
  timeout_seconds?: number;
}): Promise<ToolResult> {
  return runVideoJob(args, "enrich", "enrichment");
}

async function runVideoJob(
  args: { id: string; wait?: boolean; timeout_seconds?: number },
  operation: "optimize" | "enrich",
  field: "social_optimization" | "enrichment",
): Promise<ToolResult> {
  try {
    let response = await apiRequest<DataResponse<Video>>({
      method: "POST",
      path: `/v1/videos/${encodeURIComponent(args.id)}/${operation}`,
    });
    let video = response.data;
    if (!args.wait) return toolOk(video);

    const deadline = Date.now() + (args.timeout_seconds ?? 600) * 1000;
    let delay = 1000;
    for (;;) {
      const status = video[field]?.status;
      if (status !== "pending" && status !== "processing") return toolOk(video);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return toolOk({ ...video, wait_timed_out: true });
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
      response = await apiRequest<DataResponse<Video>>({
        path: `/v1/videos/${encodeURIComponent(args.id)}`,
      });
      video = response.data;
      delay = Math.min(Math.ceil(delay * 1.5), 5000);
    }
  } catch (error) {
    return toolFromError(error);
  }
}
