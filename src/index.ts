import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getApiKey } from "./config.js";
import { uploadImage, uploadImageInputSchema } from "./tools/upload-image.js";
import { listImages, listImagesInputSchema } from "./tools/list-images.js";
import { getImage, getImageInputSchema } from "./tools/get-image.js";
import { deleteImage, deleteImageInputSchema } from "./tools/delete-image.js";
import { updateImageMetadata, updateImageMetadataInputSchema } from "./tools/update-image-metadata.js";
import { signUrl, signUrlInputSchema } from "./tools/sign-url.js";
import { transformImage, transformImageInputSchema } from "./tools/transform-image.js";
import { optimizeImage, optimizeImageInputSchema } from "./tools/optimize-image.js";

// On the stdio transport, STDOUT is the MCP protocol channel — anything written
// there that isn't a framed JSON-RPC message corrupts the stream. All human/log
// output MUST go to stderr.
function logErr(msg: string): void {
  process.stderr.write(`[pixelvault-local-mcp] ${msg}\n`);
}

// Shared hint appended to tools that return a CDN URL — lets an agent discover
// that the URL supports on-the-fly transforms via query params (no extra call).
const transformHint =
  " The returned CDN URL supports on-the-fly transforms via query params — " +
  "e.g. ?w=400&fit=cover (resize/crop), ?fmt=webp (format), " +
  "?segment=foreground (AI background removal → transparent PNG), and effects " +
  "like ?blur=30&saturation=0&rotate=90. Or call transform_image to build a " +
  "valid transform URL for you. See https://pixelvault.dev/docs#transforms.";

function buildServer(): McpServer {
  const server = new McpServer({ name: "pixelvault-local", version: "0.4.0" });

  server.registerTool(
    "upload_image",
    {
      title: "Upload image",
      description:
        "Upload an image to PixelVault and get an instant CDN URL. Prefer `path` — " +
        "a LOCAL file path the server reads off disk and streams — so large files " +
        "aren't base64-encoded into the model context. Alternatively pass " +
        "`source_url` (a public https URL the API imports) or `data` (base64 bytes). " +
        "Optional `folder`, `metadata` (custom JSON tags), `describe` (AI alt text + caption + OCR, async), `filename`, `visibility` (private → signed URL, needs a " +
        "secret key), `expires_in` (auto-expiring image), `sign_expires_in`. Max 5 MB; " +
        "JPG/PNG/GIF/WebP/AVIF/SVG." +
        transformHint,
      inputSchema: uploadImageInputSchema,
    },
    (args) => uploadImage(args)
  );

  server.registerTool(
    "list_images",
    {
      title: "List images",
      description:
        "List images in your PixelVault project, most recent first (GET /v1/images), " +
        "paginated via `page`/`per_page`; optional `metadata` filters by custom metadata and `q` searches AI descriptions." +
        transformHint,
      inputSchema: listImagesInputSchema,
    },
    (args) => listImages(args)
  );

  server.registerTool(
    "get_image",
    {
      title: "Get image",
      description:
        "Get metadata (CDN URL, size, MIME type, dimensions) for one PixelVault image " +
        "by id (GET /v1/images/:id)." +
        transformHint,
      inputSchema: getImageInputSchema,
    },
    (args) => getImage(args)
  );

  server.registerTool(
    "delete_image",
    {
      title: "Delete image",
      description: "Permanently delete one PixelVault image by id (DELETE /v1/images/:id).",
      inputSchema: deleteImageInputSchema,
    },
    (args) => deleteImage(args)
  );

  server.registerTool(
    "update_image_metadata",
    {
      title: "Update image metadata",
      description:
        "Replace one image's custom metadata (a JSON object you can later filter list_images by). " +
        "The object replaces the stored one, so send every key to keep; null clears it " +
        "(PATCH /v1/images/:id).",
      inputSchema: updateImageMetadataInputSchema,
    },
    (args) => updateImageMetadata(args)
  );

  server.registerTool(
    "sign_url",
    {
      title: "Sign private URL",
      description:
        "Mint a time-limited signed URL for a private image (POST /v1/images/:id/sign-url). " +
        "The signature binds the image, so the URL can't be replayed against another; " +
        "strip it and the CDN returns 403. Optional `expires_in` (seconds, default 3600).",
      inputSchema: signUrlInputSchema,
    },
    (args) => signUrl(args)
  );

  server.registerTool(
    "transform_image",
    {
      title: "Build transform URL",
      description:
        "Build an on-the-fly transform URL for a PixelVault image (resize, crop, " +
        "format/quality, AI background removal, blur/sharpen/rotate/flip, " +
        "brightness/contrast/saturation, and same-project watermark tiling). Provide " +
        "exactly one of `url` (a PixelVault CDN URL) or `id` (resolved via the API), " +
        "plus one or more transform params. See https://pixelvault.dev/docs#transforms.",
      inputSchema: transformImageInputSchema,
    },
    (args) => transformImage(args)
  );

  server.registerTool(
    "optimize_image",
    {
      title: "Optimize local image",
      description:
        "Compress, resize and convert a LOCAL image file on this machine — no API key, nothing is uploaded. " +
        "Use before committing or attaching an image, or when asked to make an image smaller. " +
        "`path` is the file; optional `format` (keep|webp|avif|jpg|png, default keep), `max_width`/`max_height` " +
        "(never upscales), `quality` (1-100, default 80), `keep_metadata` (EXIF/GPS is stripped by default), " +
        "`output_path` or `in_place`, and `dry_run` to preview. Writes <name>.optimized.<ext> next to the original " +
        "by default and never makes a file bigger (an already-optimal file is left alone). Supports JPG/PNG/WebP/AVIF; " +
        "for an image already hosted on PixelVault use transform_image (fmt/q/w) instead.",
      inputSchema: optimizeImageInputSchema,
    },
    (args) => optimizeImage(args)
  );

  return server;
}

async function main(): Promise<void> {
  if (!getApiKey()) {
    logErr(
      "warning: no API key found. Set PIXELVAULT_API_KEY (or run `pixelvault login`/" +
        "`register` in the CLI). Tools will return a missing_api_key error until then."
    );
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr("ready — serving PixelVault tools over stdio.");
}

main().catch((err) => {
  logErr(`fatal: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
