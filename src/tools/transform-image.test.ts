import { describe, it, expect } from "vitest";
import { transformImage } from "./transform-image.js";
import { uploadImage } from "./upload-image.js";

/** Read the JSON payload out of an MCP tool result's text content. */
function payload(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("transform_image (pure URL building — no network)", () => {
  it("appends mapped query params to a CDN url", async () => {
    const res = await transformImage({
      url: "https://img.pixelvault.dev/proj/img_abc.png",
      width: 400,
      fit: "cover",
      format: "webp",
    });
    expect(res.isError).toBeUndefined();
    const url = new URL(payload(res).url as string);
    expect(url.searchParams.get("w")).toBe("400");
    expect(url.searchParams.get("fit")).toBe("cover");
    expect(url.searchParams.get("fmt")).toBe("webp");
  });

  it("rejects a non-PixelVault host (anti-spoofing)", async () => {
    const res = await transformImage({ url: "https://evil.example.com/x.png", width: 100 });
    expect(res.isError).toBe(true);
    expect((payload(res).error as { code: string }).code).toBe("invalid_input");
  });

  it("requires exactly one of url or id", async () => {
    const res = await transformImage({ width: 100 });
    expect(res.isError).toBe(true);
  });

  it("requires at least one transform param", async () => {
    const res = await transformImage({ url: "https://img.pixelvault.dev/p/i.png" });
    expect(res.isError).toBe(true);
  });
});

describe("upload_image input validation (no network)", () => {
  it("rejects when no source is given", async () => {
    const res = await uploadImage({});
    expect(res.isError).toBe(true);
    expect((payload(res).error as { code: string }).code).toBe("invalid_input");
  });

  it("rejects when more than one source is given", async () => {
    const res = await uploadImage({ path: "/tmp/a.png", data: "abc" });
    expect(res.isError).toBe(true);
    expect((payload(res).error as { code: string }).code).toBe("invalid_input");
  });

  it("returns a clean error for an unreadable local path", async () => {
    const res = await uploadImage({ path: "/definitely/not/here/nope.png" });
    expect(res.isError).toBe(true);
    expect((payload(res).error as { code: string }).code).toBe("file_read_failed");
  });
});
