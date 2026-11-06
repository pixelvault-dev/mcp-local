// Local copy of pixelvault-cli's src/lib/optimize.ts (same pipeline and behaviour). Keep the two in sync.

export type OutFormat = "keep" | "webp" | "avif" | "jpg" | "png";

export interface OptimizeOptions {
  format: OutFormat;
  maxWidth?: number;
  maxHeight?: number;
  /** 1-100. Applies to JPEG/WebP/AVIF output; PNG output is always lossless. */
  quality: number;
  keepMetadata: boolean;
}

export interface OptimizeResult {
  status: "optimized" | "skipped";
  /** Why the original was kept (only when status is "skipped"). */
  reason?: string;
  inputBytes: number;
  outputBytes: number;
  /** Extension (no dot) of the output; equals the input's when skipped. */
  ext: string;
  width?: number;
  height?: number;
  /** The optimized bytes (only when status is "optimized"). */
  buffer?: Buffer;
}

// Minimal structural type for the bits of sharp we use, so tests can inject a fake
// and the CLI still builds when the optional dependency isn't installed.
export type SharpFactory = (input: Buffer, options?: Record<string, unknown>) => any;

/** Decode limits: refuse decompression bombs instead of allocating gigabytes. */
export const MAX_INPUT_PIXELS = 100 * 1000 * 1000;
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const SHARP_INPUT = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" } as const;

/** Below this saving, a same-format, same-size re-encode is left alone. */
export const MIN_SAVING_PERCENT = 5;

export const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"] as const;

/** sharp's floor (it is an optional dependency, so npm only warns on older Node). */
const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 9;

/**
 * Load sharp lazily. It is an optionalDependency: when its prebuilt binary is
 * missing (unusual libc, `--omit=optional`, locked-down CI) we say how to fix it
 * instead of crashing, and every other command keeps working.
 */
export async function loadSharp(): Promise<SharpFactory> {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    throw new Error(
      `optimize needs Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer (you have ${process.versions.node}).`
    );
  }
  try {
    const mod: any = await import("sharp");
    return (mod.default ?? mod) as SharpFactory;
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(
      "optimize needs the optional 'sharp' package, which couldn't be loaded for this platform.\n" +
        `  Reason: ${why}\n` +
        "  Fix: reinstall pixelvault-cli without --omit=optional (npm install -g pixelvault-cli)."
    );
  }
}

/** Map our format names to sharp's, resolving "keep" from the detected input format. */
function resolveOutput(format: OutFormat, detected: string): { sharpFormat: string; ext: string } | null {
  const target = format === "keep" ? detected : format === "jpg" ? "jpeg" : format;
  switch (target) {
    case "jpeg":
      return { sharpFormat: "jpeg", ext: "jpg" };
    case "png":
      return { sharpFormat: "png", ext: "png" };
    case "webp":
      return { sharpFormat: "webp", ext: "webp" };
    case "avif":
      return { sharpFormat: "avif", ext: "avif" };
    default:
      return null;
  }
}

export async function optimizeBuffer(
  sharp: SharpFactory,
  input: Buffer,
  inputExt: string,
  opts: OptimizeOptions
): Promise<OptimizeResult> {
  const base = { inputBytes: input.length, outputBytes: input.length, ext: inputExt };
  const skip = (reason: string): OptimizeResult => ({ status: "skipped", reason, ...base });

  let meta: any;
  try {
    meta = await sharp(input, SHARP_INPUT).metadata();
  } catch (err) {
    // A corrupt or oversized file is a failure the caller must see (CI should not pass on it).
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/pixel limit/i.test(msg) ? `image is over ${MAX_INPUT_PIXELS / 1e6} megapixels` : "not a readable image");
  }

  // Animated images, vector graphics and HEIC are out of scope for v1.
  if (meta.format === "svg") return skip("SVG is not supported");
  if (meta.format === "gif") return skip("GIF is not supported");
  if ((meta.pages ?? 1) > 1) return skip("animated images are not supported");
  if (meta.format === "heif" && meta.compression === "hevc") {
    return skip("HEIC is not supported (convert it at https://pixelvault.dev/tools/heic-to-url/)");
  }

  const detected = meta.format === "heif" ? "avif" : meta.format;
  const out = resolveOutput(opts.format, detected);
  if (!out) return skip(`unsupported format: ${meta.format}`);

  // Apply EXIF orientation BEFORE metadata is dropped, otherwise phone photos come out sideways.
  let pipeline = sharp(input, SHARP_INPUT).rotate();

  if (opts.maxWidth || opts.maxHeight) {
    pipeline = pipeline.resize({
      width: opts.maxWidth,
      height: opts.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // JPEG has no alpha: flatten onto white rather than letting transparency go black.
  if (out.sharpFormat === "jpeg" && meta.hasAlpha) {
    pipeline = pipeline.flatten({ background: "#ffffff" });
  }

  if (opts.keepMetadata) pipeline = pipeline.keepMetadata(); // sharp strips metadata by default

  switch (out.sharpFormat) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: opts.quality, mozjpeg: true });
      break;
    case "png":
      pipeline = pipeline.png({ compressionLevel: 9, effort: 10 }); // lossless
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: opts.quality, effort: 5 });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: opts.quality, effort: 4 });
      break;
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  // Never hand back something bigger than what we were given.
  if (data.length >= input.length) {
    return skip("already optimal (result was not smaller)");
  }
  // Same format and same pixel size: a sliver of saving isn't worth rewriting the file. Keeps
  // re-runs (pre-commit hooks, CI) idempotent instead of nibbling an image every time. Compared on
  // the real detected format and oriented dimensions (not just the flags), with the unrounded ratio.
  const swap = (meta.orientation ?? 1) >= 5;
  const inW = swap ? meta.height : meta.width;
  const inH = swap ? meta.width : meta.height;
  const unchanged = out.sharpFormat === detected && info.width === inW && info.height === inH;
  if (unchanged && (input.length - data.length) / input.length < MIN_SAVING_PERCENT / 100) {
    return skip(`already optimal (would save under ${MIN_SAVING_PERCENT}%)`);
  }
  return {
    status: "optimized",
    inputBytes: input.length,
    outputBytes: data.length,
    ext: out.ext,
    width: info.width,
    height: info.height,
    buffer: data,
  };
}

/** Percentage saved, e.g. 84 for "-84%". */
export function savedPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}
