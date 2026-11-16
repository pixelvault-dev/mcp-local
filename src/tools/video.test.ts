import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteVideo,
  enrichVideo,
  getVideo,
  listVideos,
  optimizeVideo,
  signVideoUrl,
  updateVideo,
  uploadVideo,
} from "./video.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function result(resultValue: Awaited<ReturnType<typeof getVideo>>): Record<string, unknown> {
  return JSON.parse(resultValue.content[0]!.text) as Record<string, unknown>;
}

describe("local MCP video tools", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PIXELVAULT_API_KEY;
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    process.env.PIXELVAULT_API_KEY = "pv_live_test";
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PIXELVAULT_API_KEY;
    else process.env.PIXELVAULT_API_KEY = originalKey;
  });

  it("uploads a local MP4 with lifecycle and replay-safety headers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pv-mcp-video-"));
    const path = join(dir, "hello world.mp4");
    await writeFile(path, Buffer.from("mp4"));
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "vid_1", visibility: "private", original_url: "https://signed" } }, 201);
    }) as typeof fetch;
    try {
      const output = await uploadVideo({
        path,
        visibility: "private",
        expires_in: 3600,
        sign_expires_in: 300,
        folder: "demos",
        collection_id: "col_1",
        metadata: { env: "test" },
        social_ready: true,
        idempotency_key: "retry-1",
      });
      expect(result(output).id).toBe("vid_1");
      expect(calls[0]!.init.headers).toMatchObject({
        "Content-Type": "video/mp4",
        "Content-Length": "3",
        "X-PixelVault-Filename": "hello%20world.mp4",
        "X-PixelVault-Visibility": "private",
        "X-PixelVault-Expires-In": "3600",
        "X-PixelVault-Sign-Expires-In": "300",
        "X-PixelVault-Folder": "demos",
        "X-PixelVault-Collection-Id": "col_1",
        "X-PixelVault-Metadata": '{"env":"test"}',
        "X-PixelVault-Social-Ready": "true",
        "Idempotency-Key": "retry-1",
        "X-PixelVault-Content-SHA256": "862c4ec62defaadafbf7638961214d286015c38ed4ccc7b10d52bdf434e5bee1",
      });
      expect(Buffer.from(calls[0]!.init.body as Uint8Array).toString()).toBe("mp4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("imports a public HTTPS video with idempotency", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "vid_1", visibility: "public" } }, 201);
    }) as typeof fetch;
    await uploadVideo({
      source_url: "https://example.com/demo.mp4",
      folder: "demos",
      metadata: { source: "test" },
      idempotency_key: "import-1",
    });
    expect(calls[0]!.init.headers).toMatchObject({ "Idempotency-Key": "import-1" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      url: "https://example.com/demo.mp4",
      folder: "demos",
      metadata: { source: "test" },
    });
  });

  it("gets, filters, updates, signs, and deletes videos", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/v1/videos") return response({ data: [{ id: "vid_1" }], meta: { total: 1 } });
      if (pathname.endsWith("/sign-url")) return response({ data: { url: "https://signed", expires: 123, enrichment: {} } });
      if (init?.method === "DELETE") return response({ success: true });
      return response({ data: { id: "vid_1", enrichment: { status: "complete" } } });
    }) as typeof fetch;

    expect(result(await getVideo({ id: "vid/1" })).id).toBe("vid_1");
    await listVideos({ page: 2, folder: "demos", collection_id: "col_1", metadata: { env: "test" } });
    await updateVideo({ id: "vid_1", metadata: null, folder: "archive", collection_id: null });
    expect(result(await signVideoUrl({ id: "vid_1", expires_in: 300 })).url).toBe("https://signed");
    expect(result(await deleteVideo({ id: "vid_1" })).success).toBe(true);

    expect(new URL(calls[0]!.url).pathname).toBe("/v1/videos/vid%2F1");
    const listUrl = new URL(calls[1]!.url);
    expect(listUrl.searchParams.get("collection_id")).toBe("col_1");
    expect(JSON.parse(listUrl.searchParams.get("metadata") as string)).toEqual({ env: "test" });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      metadata: null,
      folder: "archive",
      collection_id: null,
    });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ expires_in: 300 });
  });

  it("returns job IDs immediately and marks only local wait timeout", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const field = String(url).endsWith("/enrich")
        ? { enrichment: { status: "pending", job_id: "ven_1" } }
        : { social_optimization: { status: "complete", job_id: "vop_1" } };
      return response({ data: { id: "vid_1", ...field } }, 202);
    }) as typeof fetch;

    const queued = result(await enrichVideo({ id: "vid_1" }));
    expect((queued.enrichment as Record<string, unknown>).job_id).toBe("ven_1");
    expect(calls).toHaveLength(1);

    const timedOut = result(await enrichVideo({ id: "vid_1", wait: true, timeout_seconds: 0 }));
    expect(timedOut.wait_timed_out).toBe(true);
    expect((timedOut.enrichment as Record<string, unknown>).status).toBe("pending");

    const optimized = result(await optimizeVideo({ id: "vid_1", wait: true }));
    expect((optimized.social_optimization as Record<string, unknown>).status).toBe("complete");
  });
});
