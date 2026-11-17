import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteAudio,
  enrichAudio,
  getAudio,
  listAudio,
  signAudioUrl,
  updateAudio,
  uploadAudio,
} from "./audio.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function result(resultValue: Awaited<ReturnType<typeof getAudio>>): Record<string, unknown> {
  return JSON.parse(resultValue.content[0]!.text) as Record<string, unknown>;
}

describe("local MCP audio tools", () => {
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

  it("uploads local OGG bytes with lifecycle and replay-safety headers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pv-mcp-audio-"));
    const path = join(dir, "hello world.ogg");
    await writeFile(path, Buffer.from("ogg"));
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "aud_1", visibility: "private", original_url: "https://signed" } }, 201);
    }) as typeof fetch;
    try {
      const output = await uploadAudio({
        path,
        visibility: "private",
        expires_in: 3600,
        sign_expires_in: 300,
        folder: "episodes",
        collection_id: "col_1",
        metadata: { season: 1 },
        idempotency_key: "audio-retry-1",
      });
      expect(result(output).id).toBe("aud_1");
      expect(calls[0]!.init.headers).toMatchObject({
        "Content-Type": "audio/ogg",
        "Content-Length": "3",
        "X-PixelVault-Filename": "hello%20world.ogg",
        "X-PixelVault-Visibility": "private",
        "X-PixelVault-Expires-In": "3600",
        "X-PixelVault-Sign-Expires-In": "300",
        "X-PixelVault-Folder": "episodes",
        "X-PixelVault-Collection-Id": "col_1",
        "X-PixelVault-Metadata": '{"season":1}',
        "Idempotency-Key": "audio-retry-1",
        "X-PixelVault-Content-SHA256": "90308fe99871113bf5490ec73a8813b667adc60fe01530102a6c7bfb73c66481",
      });
      expect(Buffer.from(calls[0]!.init.body as Uint8Array).toString()).toBe("ogg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects local audio above the approved global ceiling before reading it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pv-mcp-audio-limit-"));
    const path = join(dir, "oversized.mp3");
    await writeFile(path, "");
    await truncate(path, 25_000_001);
    try {
      const uploaded = await uploadAudio({ path });
      expect(uploaded.isError).toBe(true);
      expect(uploaded.content[0]?.text).toContain("25,000,000 bytes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("imports public audio with idempotency", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "aud_1", visibility: "public" } }, 201);
    }) as typeof fetch;
    await uploadAudio({
      source_url: "https://example.com/demo.m4a",
      filename: "demo.m4a",
      metadata: { source: "test" },
      idempotency_key: "audio-import-1",
    });
    expect(calls[0]!.init.headers).toMatchObject({ "Idempotency-Key": "audio-import-1" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      url: "https://example.com/demo.m4a",
      filename: "demo.m4a",
      metadata: { source: "test" },
    });
  });

  it("gets, filters, updates, signs, and deletes audio", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/v1/audio") return response({ data: [{ id: "aud_1" }], meta: { total: 1 } });
      if (pathname.endsWith("/sign-url")) return response({ data: { url: "https://signed", expires: 123, visibility: "private" } });
      if (init?.method === "DELETE") return response({ success: true });
      return response({ data: { id: "aud_1" } });
    }) as typeof fetch;

    expect(result(await getAudio({ id: "aud/1" })).id).toBe("aud_1");
    await listAudio({ page: 2, folder: "episodes", collection_id: "col_1", metadata: { season: 1 } });
    await updateAudio({ id: "aud_1", metadata: null, folder: "archive", collection_id: null });
    expect(result(await signAudioUrl({ id: "aud_1", expires_in: 300 })).url).toBe("https://signed");
    expect(result(await deleteAudio({ id: "aud_1" })).success).toBe(true);

    expect(new URL(calls[0]!.url).pathname).toBe("/v1/audio/aud%2F1");
    const listUrl = new URL(calls[1]!.url);
    expect(listUrl.searchParams.get("collection_id")).toBe("col_1");
    expect(JSON.parse(listUrl.searchParams.get("metadata") as string)).toEqual({ season: 1 });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      metadata: null,
      folder: "archive",
      collection_id: null,
    });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ expires_in: 300 });
  });

  it("starts audio enrichment and returns stable IDs immediately", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "aud_1", enrichment: { job_id: "aen_1", status: "pending" } } }, 202);
    }) as typeof fetch;

    expect(result(await enrichAudio({ id: "aud/1", wait: false }))).toMatchObject({
      id: "aud_1",
      enrichment: { job_id: "aen_1", status: "pending" },
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/audio/aud%2F1/enrich");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("polls audio enrichment with backoff and reports local timeout without cancellation", async () => {
    vi.useFakeTimers();
    const responses = [
      { data: { id: "aud_1", enrichment: { job_id: "aen_1", status: "processing" } } },
      {
        data: {
          id: "aud_1",
          enrichment: {
            job_id: "aen_1",
            status: "complete",
            transcript: { status: "complete", text_url: "https://img.example/transcript.txt" },
          },
        },
      },
    ];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response(responses.shift());
    }) as typeof fetch;
    const pending = enrichAudio({ id: "aud_1", wait: true, timeout_seconds: 10 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result(await pending)).toMatchObject({
      enrichment: { status: "complete", transcript: { text_url: "https://img.example/transcript.txt" } },
    });
    expect(new URL(calls[1]!.url).pathname).toBe("/v1/audio/aud_1");
    vi.useRealTimers();

    globalThis.fetch = vi.fn(async () =>
      response({ data: { id: "aud_1", enrichment: { job_id: "aen_1", status: "pending" } } }, 202)
    ) as typeof fetch;
    expect(result(await enrichAudio({ id: "aud_1", wait: true, timeout_seconds: 0 }))).toMatchObject({
      enrichment: { status: "pending" },
      wait_timed_out: true,
    });
  });
});
