import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listImages } from "./list-images.js";
import { uploadImage } from "./upload-image.js";
import { updateImageMetadata } from "./update-image-metadata.js";

const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(data), json: async () => data });

describe("metadata support", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PIXELVAULT_API_KEY;
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    process.env.PIXELVAULT_API_KEY = "pv_live_test";
    calls = [];
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return ok({ data: { id: "img_1", url: "https://x/y.png", visibility: "public", metadata: null } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PIXELVAULT_API_KEY;
    else process.env.PIXELVAULT_API_KEY = originalKey;
  });

  it("list_images sends the metadata filter as a JSON query param, omitting empty", async () => {
    await listImages({ metadata: { env: "prod", n: 3 } });
    expect(JSON.parse(new URL(calls[0]!.url).searchParams.get("metadata") as string)).toEqual({ env: "prod", n: 3 });
    await listImages({ metadata: {} });
    expect(calls[1]!.url).not.toContain("metadata");
  });

  it("upload_image sends metadata in the JSON body for a source_url import", async () => {
    await uploadImage({ source_url: "https://example.com/a.png", metadata: { env: "prod" } });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ url: "https://example.com/a.png", metadata: { env: "prod" } });
  });

  it("upload_image sends metadata as a JSON string form field for base64 data", async () => {
    await uploadImage({ data: "iVBORw0KGgo=", metadata: { run: 42 } });
    const form = calls[0]!.init.body as FormData;
    expect(JSON.parse(form.get("metadata") as string)).toEqual({ run: 42 });
    await uploadImage({ data: "iVBORw0KGgo=", metadata: {} });
    expect((calls[1]!.init.body as FormData).get("metadata")).toBeNull();
  });

  it("update_image_metadata PATCHes the object, or null to clear", async () => {
    await updateImageMetadata({ id: "img_1", metadata: { a: 1 } });
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(calls[0]!.url).toContain("/v1/images/img_1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ metadata: { a: 1 } });
    await updateImageMetadata({ id: "img_1", metadata: null });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ metadata: null });
  });

  it("list_images sends q (trimmed away when blank)", async () => {
    await listImages({ q: "invoice 4821" });
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("invoice 4821");
    await listImages({ q: "  " });
    expect(calls[1]!.url).not.toContain("q=");
  });

  it("upload_image sends describe=true in the JSON body and the form, only when set", async () => {
    await uploadImage({ source_url: "https://example.com/a.png", describe: true });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ describe: true });
    await uploadImage({ data: "iVBORw0KGgo=", describe: true });
    expect((calls[1]!.init.body as FormData).get("describe")).toBe("true");
    await uploadImage({ data: "iVBORw0KGgo=" });
    expect((calls[2]!.init.body as FormData).get("describe")).toBeNull();
    await uploadImage({ source_url: "https://example.com/a.png" });
    expect(JSON.parse(String(calls[3]!.init.body))).not.toHaveProperty("describe");
  });
});
