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
import {
  deleteVideo,
  deleteVideoInputSchema,
  enrichVideo,
  enrichVideoInputSchema,
  getVideo,
  getVideoInputSchema,
  listVideos,
  listVideosInputSchema,
  optimizeVideo,
  optimizeVideoInputSchema,
  signVideoUrl,
  signVideoUrlInputSchema,
  updateVideo,
  updateVideoInputSchema,
  uploadVideo,
  uploadVideoInputSchema,
} from "./tools/video.js";
import {
  deleteAudio,
  deleteAudioInputSchema,
  enrichAudio,
  enrichAudioInputSchema,
  getAudio,
  getAudioInputSchema,
  listAudio,
  listAudioInputSchema,
  signAudioUrl,
  signAudioUrlInputSchema,
  updateAudio,
  updateAudioInputSchema,
  uploadAudio,
  uploadAudioInputSchema,
} from "./tools/audio.js";

// On the stdio transport, STDOUT is the MCP protocol channel — anything written
// there that isn't a framed JSON-RPC message corrupts the stream. All human/log
// output MUST go to stderr.
function logErr(msg: string): void {
  process.stderr.write(`[pixelvault-local-mcp] ${msg}\n`);
}

// Shared hint appended to tools that return a CDN URL — lets an agent discover
// that the URL supports on-the-fly transforms via query params (no extra call).
const transformHint =
  " Image CDN URLs support on-the-fly transforms via query params — " +
  "e.g. ?w=400&fit=cover (resize/crop), ?fmt=webp (format), " +
  "?segment=foreground (AI background removal → transparent PNG), and effects " +
  "like ?blur=30&saturation=0&rotate=90. Or call transform_image to build a " +
  "valid transform URL for you. PDFs are forced downloads and reject transforms. See https://pixelvault.dev/docs#transforms.";

function buildServer(): McpServer {
  const server = new McpServer({ name: "pixelvault-local", version: "0.6.0" });

  server.registerTool(
    "upload_image",
    {
      title: "Upload image or PDF",
      description:
        "Upload an image or PDF to PixelVault and get an instant CDN URL. Prefer `path` — " +
        "a LOCAL file path the server reads off disk and streams — so large files " +
        "aren't base64-encoded into the model context. Alternatively pass " +
        "`source_url` (a public https URL the API imports) or `data` (base64 bytes). " +
        "Optional `folder`, `metadata` (custom JSON tags), `describe` (images only: AI alt text + caption + OCR, async), `filename`, `visibility` (private → signed URL, needs a " +
        "secret key), `expires_in` (auto-expiring upload), `sign_expires_in`. Max 5 MB; " +
        "JPG/PNG/GIF/WebP/AVIF/SVG/PDF." +
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


  server.registerTool(
    "upload_video",
    {
      title: "Upload video",
      description:
        "Upload a local MP4 path (direct uploads up to 100 MB) or securely import a public HTTPS MP4 URL. " +
        "Supports public/private access, deletion TTL, folder, collection, metadata, private URL expiry, " +
        "social-ready optimization, and replay-safe idempotency. Returns the stable asset ID immediately.",
      inputSchema: uploadVideoInputSchema,
    },
    (args) => uploadVideo(args)
  );

  server.registerTool(
    "list_videos",
    {
      title: "List videos",
      description: "List project videos with pagination and optional folder, collection, or metadata filters.",
      inputSchema: listVideosInputSchema,
    },
    (args) => listVideos(args)
  );

  server.registerTool(
    "get_video",
    {
      title: "Get video",
      description:
        "Resume from a stable video asset ID and return current optimization/enrichment status plus only the " +
        "original, poster, transcript, storyboard, and optimized URLs that exist.",
      inputSchema: getVideoInputSchema,
    },
    (args) => getVideo(args)
  );

  server.registerTool(
    "update_video",
    {
      title: "Update video",
      description: "Replace video metadata, folder, or existing collection membership. Null clears a field.",
      inputSchema: updateVideoInputSchema,
    },
    (args) => updateVideo(args)
  );

  server.registerTool(
    "sign_video_url",
    {
      title: "Sign video URLs",
      description:
        "Mint expiry-matched private original, poster, optimized, and available enrichment artifact URLs. " +
        "No artifact URL is invented before the artifact exists.",
      inputSchema: signVideoUrlInputSchema,
    },
    (args) => signVideoUrl(args)
  );

  server.registerTool(
    "optimize_video",
    {
      title: "Optimize video",
      description:
        "Start social-ready optimization. Returns asset/job IDs immediately by default; optional bounded polling " +
        "can be resumed with get_video. Local timeout does not cancel the server job.",
      inputSchema: optimizeVideoInputSchema,
    },
    (args) => optimizeVideo(args)
  );

  server.registerTool(
    "enrich_video",
    {
      title: "Enrich video",
      description:
        "Start transcript/storyboard enrichment. Returns asset/job IDs immediately by default; optional bounded " +
        "polling can be resumed with get_video. Local timeout does not cancel the server job.",
      inputSchema: enrichVideoInputSchema,
    },
    (args) => enrichVideo(args)
  );

  server.registerTool(
    "delete_video",
    {
      title: "Delete video",
      description: "Permanently delete a video original and all available derived artifacts.",
      inputSchema: deleteVideoInputSchema,
    },
    (args) => deleteVideo(args)
  );

  server.registerTool(
    "upload_audio",
    {
      title: "Upload audio",
      description:
        "Upload a local MP3, WAV, M4A, or OGG path or securely import a public HTTP(S) URL. " +
        "Supports public/private access, deletion TTL, folder, collection, metadata, private URL expiry, and replay-safe idempotency. " +
        "The server validates actual container/codec bytes. Originals are limited to the approved global 25,000,000-byte maximum, not a plan allowance.",
      inputSchema: uploadAudioInputSchema,
    },
    (args) => uploadAudio(args)
  );

  server.registerTool(
    "enrich_audio",
    {
      title: "Enrich audio",
      description:
        "Start or resume transcription for a hosted aud_ asset. Returns stable asset/job IDs immediately by default, " +
        "or polls with bounded backoff when wait=true. Produces plain text, WebVTT, and timestamped JSON when complete; no storyboard.",
      inputSchema: enrichAudioInputSchema,
    },
    (args) => enrichAudio(args)
  );

  server.registerTool(
    "list_audio",
    {
      title: "List audio",
      description: "List project audio with pagination and optional folder, collection, or metadata filters.",
      inputSchema: listAudioInputSchema,
    },
    (args) => listAudio(args)
  );

  server.registerTool(
    "get_audio",
    {
      title: "Get audio status and artifacts",
      description: "Get the original, transcription job state, available transcript URLs, privacy, expiry, media metadata, and organization by stable aud_ ID.",
      inputSchema: getAudioInputSchema,
    },
    (args) => getAudio(args)
  );

  server.registerTool(
    "update_audio",
    {
      title: "Update audio",
      description: "Replace audio metadata, folder, or existing collection membership. Null clears a field.",
      inputSchema: updateAudioInputSchema,
    },
    (args) => updateAudio(args)
  );

  server.registerTool(
    "sign_audio_url",
    {
      title: "Sign audio URLs",
      description: "Mint fresh time-limited original and available transcript URLs for private audio. This does not change privacy or deletion TTL.",
      inputSchema: signAudioUrlInputSchema,
    },
    (args) => signAudioUrl(args)
  );

  server.registerTool(
    "delete_audio",
    {
      title: "Delete audio",
      description: "Permanently delete an audio original, transcript artifacts, and active-job state, releasing applicable storage and reserved enrichment seconds.",
      inputSchema: deleteAudioInputSchema,
    },
    (args) => deleteAudio(args)
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
