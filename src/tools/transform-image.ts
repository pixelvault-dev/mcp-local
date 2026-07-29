import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolError, toolFromError, type ToolResult } from "../result.js";

/** The PixelVault image CDN (serve worker) origin — the only host we'll dress
 *  up with transform params. Kept in lockstep with the monorepo's CDN_HOST. */
const CDN_HOST = "img.pixelvault.dev";

export const transformImageInputSchema = {
  url: z
    .string()
    .optional()
    .describe(
      "Absolute PixelVault CDN URL (as returned by upload_image / get_image / " +
        "list_images). Provide this OR id."
    ),
  id: z
    .string()
    .optional()
    .describe("PixelVault image id (e.g. img_abc123); its CDN URL is resolved via the API. Provide this OR url."),
  size: z
    .enum(["s", "m", "l", "social"])
    .optional()
    .describe("Named size preset: s=256px, m=640px, l=1280px, social=1200x630 OG card. Wins over width/height."),
  width: z.number().int().positive().max(4000).optional().describe("Target width in px (1..4000)."),
  height: z.number().int().positive().max(4000).optional().describe("Target height in px (1..4000)."),
  fit: z
    .enum(["scale-down", "contain", "cover", "crop", "pad"])
    .optional()
    .describe("Resize mode. scale-down (default) never enlarges; others may upscale. Only with width/height."),
  format: z.enum(["auto", "webp", "avif", "jpg", "png"]).optional().describe("Output format. auto negotiates WebP/AVIF."),
  quality: z.enum(["auto", "60", "75", "85"]).optional().describe("Output quality. auto lets Cloudflare choose."),
  segment: z
    .enum(["foreground"])
    .optional()
    .describe("AI background removal: foreground keeps the subject, background becomes transparent (PNG output)."),
  background: z.string().optional().describe("Fill color behind a removed/padded background: hex, rgb(), or CSS name."),
  gravity: z.string().optional().describe("Crop anchor with fit=cover|crop: face, left, right, top, bottom, auto, or 'XxY'."),
  zoom: z.number().min(0).max(1).optional().describe("Face-crop tightness 0.0-1.0, only with gravity=face."),
  blur: z.number().min(0).max(250).optional().describe("Gaussian blur (0-250)."),
  sharpen: z.number().min(0).max(10).optional().describe("Sharpen strength (0-10)."),
  rotate: z.number().optional().describe("Rotate clockwise; rounded to the nearest right angle."),
  flip: z.enum(["h", "v", "hv"]).optional().describe("Mirror horizontally (h), vertically (v), or both (hv)."),
  brightness: z.number().min(0).max(2).optional().describe("Brightness multiplier 0-2 (1=no change)."),
  contrast: z.number().min(0).max(2).optional().describe("Contrast multiplier 0-2 (1=no change)."),
  saturation: z.number().min(0).max(2).optional().describe("Saturation multiplier 0-2 (1=no change, 0=grayscale)."),
  tile: z.string().optional().describe("Filename of another image in the SAME project to tile as a watermark."),
};

interface TransformArgs {
  url?: string;
  id?: string;
  [param: string]: unknown;
}

/** Input param → serve-worker query key (stable order). */
const QUERY_KEYS: Record<string, string> = {
  size: "size",
  width: "w",
  height: "h",
  fit: "fit",
  format: "fmt",
  quality: "q",
  segment: "segment",
  background: "background",
  gravity: "gravity",
  zoom: "zoom",
  blur: "blur",
  sharpen: "sharpen",
  rotate: "rotate",
  flip: "flip",
  brightness: "brightness",
  contrast: "contrast",
  saturation: "saturation",
  tile: "tile",
};

/**
 * transform_image — build an on-the-fly transform URL for a PixelVault image.
 * Mostly a pure URL builder; the only network call resolves `id` → CDN URL.
 */
export async function transformImage(args: TransformArgs): Promise<ToolResult> {
  const { url, id, ...params } = args;
  if ((url && id) || (!url && !id)) {
    return toolError("invalid_input", "Provide exactly one of url or id.");
  }

  let baseUrl = url;
  if (id) {
    try {
      const { data } = await apiRequest<{ data: { url: string } }>({
        method: "GET",
        path: `/v1/images/${encodeURIComponent(id)}`,
      });
      baseUrl = data.url;
    } catch (err) {
      return toolFromError(err);
    }
  }

  let target: URL;
  try {
    target = new URL(baseUrl as string);
  } catch {
    return toolError("invalid_input", "url must be an absolute http(s) URL.");
  }
  // Only ever transform real PixelVault CDN images — otherwise any host (or a
  // non-http scheme) parses and comes back dressed as a PixelVault transform URL.
  if (target.protocol !== "https:" || target.hostname !== CDN_HOST) {
    return toolError(
      "invalid_input",
      `url must be a PixelVault CDN URL (https://${CDN_HOST}/...). Pass an image id instead to have it resolved.`
    );
  }

  let applied = 0;
  for (const [param, key] of Object.entries(QUERY_KEYS)) {
    const value = params[param];
    if (value !== undefined) {
      target.searchParams.set(key, String(value));
      applied++;
    }
  }
  if (applied === 0) {
    return toolError("invalid_input", "Provide at least one transform parameter (e.g. width, format, segment).");
  }

  return toolOk({ url: target.toString() });
}
