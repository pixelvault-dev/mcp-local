import { z } from "zod";
import { lstatSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { toolOk, toolError, type ToolResult } from "../result.js";
import {
  loadSharp,
  optimizeBuffer,
  savedPercent,
  SUPPORTED_EXTENSIONS,
  MAX_INPUT_BYTES,
  type OutFormat,
} from "../optimize-core.js";

export const optimizeImageInputSchema = {
  path: z
    .string()
    .min(1)
    .describe("LOCAL file path of the image to optimize (JPEG, PNG, WebP or AVIF). Absolute, or relative to the server's working directory."),
  format: z
    .enum(["keep", "webp", "avif", "jpg", "png"])
    .optional()
    .describe("Output format. Default keep. WebP is usually the smallest for web use."),
  max_width: z.number().int().positive().max(20000).optional().describe("Downscale to at most this width in px. Never upscales."),
  max_height: z.number().int().positive().max(20000).optional().describe("Downscale to at most this height in px. Never upscales."),
  quality: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("JPEG/WebP/AVIF quality 1-100 (default 80). PNG output is always lossless."),
  keep_metadata: z.boolean().optional().describe("Keep EXIF/GPS metadata. Default false: it is stripped (orientation is applied first)."),
  output_path: z
    .string()
    .optional()
    .describe("Where to write the result. Default: <name>.optimized.<ext> next to the original. Must not already exist unless it is a *.optimized.* file."),
  in_place: z
    .boolean()
    .optional()
    .describe("Overwrite the original instead of writing a new file (only with format keep). Use only for files under version control."),
  dry_run: z.boolean().optional().describe("Report the saving without writing anything."),
};

interface OptimizeArgs {
  path: string;
  format?: OutFormat;
  max_width?: number;
  max_height?: number;
  quality?: number;
  keep_metadata?: boolean;
  output_path?: string;
  in_place?: boolean;
  dry_run?: boolean;
}

const OWNED = /\.optimized$/i;

/** Write via a temp file in the same directory, then rename, so a crash can't truncate the target. */
function writeAtomic(target: string, data: Buffer, mode?: number): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
}

/**
 * optimize_image — compress/resize/convert a LOCAL image file. Runs entirely on the
 * user's machine (no API key, nothing uploaded). Never writes a file bigger than the
 * original; a file that can't be made meaningfully smaller is left alone.
 */
export async function optimizeImage(args: OptimizeArgs): Promise<ToolResult> {
  const format: OutFormat = args.format ?? "keep";
  if (args.in_place && format !== "keep") {
    return toolError("invalid_input", "in_place only works with format keep (changing the format needs a different file name).");
  }
  if (args.in_place && args.output_path) {
    return toolError("invalid_input", "Use either in_place or output_path, not both.");
  }

  const source = resolve(args.path);
  let st;
  try {
    st = lstatSync(source);
  } catch {
    return toolError("not_found", `No such file: ${args.path}`);
  }
  if (!st.isFile() && !st.isSymbolicLink()) return toolError("invalid_input", `${args.path} is not a file.`);
  if (st.isSymbolicLink() && args.in_place) {
    return toolError("invalid_input", `${args.path} is a symlink; refusing to overwrite it in place. Optimize the real file.`);
  }
  const ext = extname(source).slice(1).toLowerCase();
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return toolError("unsupported_type", `Unsupported file type .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  if (statSync(source).size > MAX_INPUT_BYTES) {
    return toolError("too_large", `File is over ${MAX_INPUT_BYTES / 1024 / 1024} MB.`);
  }

  let sharp;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return toolError("sharp_unavailable", err instanceof Error ? err.message : String(err));
  }

  let result;
  try {
    result = await optimizeBuffer(sharp, readFileSync(source), ext, {
      format,
      maxWidth: args.max_width,
      maxHeight: args.max_height,
      quality: args.quality ?? 80,
      keepMetadata: Boolean(args.keep_metadata),
    });
  } catch (err) {
    return toolError("unreadable_image", err instanceof Error ? err.message : String(err));
  }

  const report = {
    input: source,
    output: null as string | null,
    status: result.status,
    reason: result.reason,
    input_bytes: result.inputBytes,
    output_bytes: result.outputBytes,
    saved_percent: savedPercent(result.inputBytes, result.outputBytes),
    width: result.width,
    height: result.height,
    dry_run: Boolean(args.dry_run),
  };

  if (result.status !== "optimized" || !result.buffer) return toolOk(report);

  // Decide where it goes. The extension keeps the input's own spelling for format keep.
  const stem = basename(source, extname(source));
  const outExt = format === "keep" ? extname(source).slice(1) : result.ext;
  const target = args.in_place
    ? source
    : args.output_path
      ? resolve(args.output_path)
      : join(dirname(source), `${stem}.optimized.${outExt}`);

  if (!args.in_place) {
    if (target === source) return toolError("invalid_input", "The output would overwrite the original. Set in_place if that is intended.");
    if (existsSync(target)) {
      const tst = lstatSync(target);
      if (tst.isSymbolicLink()) return toolError("invalid_input", `${target} is a symlink; refusing to write through it.`);
      if (!OWNED.test(basename(target, extname(target)))) {
        return toolError("exists", `${target} already exists. Choose another output_path (only *.optimized.* files are overwritten).`);
      }
    }
  }

  if (args.dry_run) return toolOk({ ...report, output: target });

  try {
    writeAtomic(target, result.buffer, args.in_place ? statSync(source).mode & 0o777 : undefined);
  } catch (err) {
    return toolError("write_failed", err instanceof Error ? err.message : String(err));
  }
  return toolOk({ ...report, output: target });
}
