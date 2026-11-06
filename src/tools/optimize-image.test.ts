import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { optimizeImage } from "./optimize-image.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pv-mcp-optimize-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function payload(result: { content: { text: string }[] }): Record<string, any> {
  return JSON.parse(result.content[0]!.text);
}

async function noisyJpeg(width = 900, height = 700): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + ((i * 2654435761) >>> 24)) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

describe("optimize_image", () => {
  it("writes <name>.optimized.<ext> beside the original and leaves the original alone", async () => {
    const orig = await noisyJpeg();
    writeFileSync(join(dir, "photo.jpg"), orig);
    const res = await optimizeImage({ path: join(dir, "photo.jpg") });
    expect(res.isError).toBeUndefined();
    const out = payload(res);
    expect(out.status).toBe("optimized");
    expect(out.output).toBe(join(dir, "photo.optimized.jpg"));
    expect(out.output_bytes).toBeLessThan(out.input_bytes);
    expect(readFileSync(join(dir, "photo.jpg")).equals(orig)).toBe(true);
  });

  it("converts to webp and downscales with max_width", async () => {
    writeFileSync(join(dir, "photo.jpg"), await noisyJpeg());
    const out = payload(await optimizeImage({ path: join(dir, "photo.jpg"), format: "webp", max_width: 400 }));
    expect(out.output).toBe(join(dir, "photo.optimized.webp"));
    expect(out.width).toBe(400);
    expect((await sharp(out.output).metadata()).format).toBe("webp");
  });

  it("a second run on its own output is a no-op (idempotent)", async () => {
    writeFileSync(join(dir, "photo.jpg"), await noisyJpeg());
    await optimizeImage({ path: join(dir, "photo.jpg") });
    const again = payload(await optimizeImage({ path: join(dir, "photo.optimized.jpg") }));
    expect(again.status).toBe("skipped");
    expect(again.output).toBeNull();
    expect(readdirSync(dir).sort()).toEqual(["photo.jpg", "photo.optimized.jpg"]);
  });

  it("dry_run reports the saving and writes nothing", async () => {
    writeFileSync(join(dir, "photo.jpg"), await noisyJpeg());
    const out = payload(await optimizeImage({ path: join(dir, "photo.jpg"), dry_run: true }));
    expect(out.status).toBe("optimized");
    expect(out.dry_run).toBe(true);
    expect(readdirSync(dir)).toEqual(["photo.jpg"]);
  });

  it("in_place overwrites atomically and keeps the exact name (.jpeg stays .jpeg)", async () => {
    const orig = await noisyJpeg();
    writeFileSync(join(dir, "photo.jpeg"), orig);
    const out = payload(await optimizeImage({ path: join(dir, "photo.jpeg"), in_place: true }));
    expect(out.output).toBe(join(dir, "photo.jpeg"));
    expect(readdirSync(dir)).toEqual(["photo.jpeg"]);
    expect(readFileSync(join(dir, "photo.jpeg")).length).toBeLessThan(orig.length);
  });

  it("refuses to overwrite an existing unrelated file", async () => {
    writeFileSync(join(dir, "photo.jpg"), await noisyJpeg());
    writeFileSync(join(dir, "taken.jpg"), "precious");
    const res = await optimizeImage({ path: join(dir, "photo.jpg"), output_path: join(dir, "taken.jpg") });
    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("exists");
    expect(readFileSync(join(dir, "taken.jpg"), "utf8")).toBe("precious");
  });

  it("refuses in_place on a symlink and writing through a symlink destination", async () => {
    writeFileSync(join(dir, "real.jpg"), await noisyJpeg());
    symlinkSync(join(dir, "real.jpg"), join(dir, "link.jpg"));
    expect((await optimizeImage({ path: join(dir, "link.jpg"), in_place: true })).isError).toBe(true);
    writeFileSync(join(dir, "other.jpg"), await noisyJpeg());
    symlinkSync(join(dir, "real.jpg"), join(dir, "other.optimized.jpg"));
    const res = await optimizeImage({ path: join(dir, "other.jpg") });
    expect(res.isError).toBe(true);
    expect(payload(res).error.message).toMatch(/symlink/);
  });

  it("validates inputs: missing file, unsupported type, in_place + format, corrupt file", async () => {
    expect(payload(await optimizeImage({ path: join(dir, "nope.png") })).error.code).toBe("not_found");
    writeFileSync(join(dir, "a.gif"), "x");
    expect(payload(await optimizeImage({ path: join(dir, "a.gif") })).error.code).toBe("unsupported_type");
    writeFileSync(join(dir, "a.png"), await noisyJpeg());
    expect((await optimizeImage({ path: join(dir, "a.png"), in_place: true, format: "webp" })).isError).toBe(true);
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "bad.png"), "<html>nope</html>");
    expect(payload(await optimizeImage({ path: join(dir, "bad.png") })).error.code).toBe("unreadable_image");
  });
});
