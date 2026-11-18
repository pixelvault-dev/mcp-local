# @pixelvault-dev/local-mcp

A **local (stdio) MCP server** for [PixelVault](https://pixelvault.dev) — agent-first media hosting.

The difference from the hosted MCP server (`mcp.pixelvault.dev`): this one runs on
**your** machine, so it can upload a local image, PDF, MP4, MP3, WAV, M4A, or OGG by path. It reads the
bytes off disk and sends them directly to the API; the file is never base64-encoded into the model's context.
That keeps media bytes and slow, token-hungry base64 round-trips out of the conversation.

Use the hosted server when your client is remote (ChatGPT, etc.); use this one for
local coding agents that have files on disk.

## Install

Runs with `npx` — no global install needed:

```bash
npx @pixelvault-dev/local-mcp
```

## Configure

Set your PixelVault API key (a `pv_live_…` secret key for private uploads):

```bash
export PIXELVAULT_API_KEY=pv_live_xxx
# optional: point at a different API
export PIXELVAULT_API_URL=https://api.pixelvault.dev
```

The server also reads `~/.pixelvault/config.json` if you've authenticated with the
[PixelVault CLI](https://github.com/pixelvault-dev/cli) (`pixelvault login`).

### Claude Desktop / MCP client config

```json
{
  "mcpServers": {
    "pixelvault": {
      "command": "npx",
      "args": ["-y", "@pixelvault-dev/local-mcp"],
      "env": { "PIXELVAULT_API_KEY": "pv_live_xxx" }
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `upload_image` | Upload an image or PDF by local **`path`** (streamed, no base64), or `source_url`, or `data`. Optional `folder`, `visibility`, `expires_in`, `metadata`, `describe` (images only: AI alt text + caption + OCR in the background; read it with `get_image`). PDF URLs are forced downloads and reject image transforms. |
| `list_images` | List images in your project (paginated), optionally filtered by custom `metadata` or searched by AI description (`q`: alt text, caption, OCR text). |
| `get_image` | Metadata for one image by id. |
| `update_image_metadata` | Replace an image's custom metadata (replaces, not merges; `null` clears). |
| `delete_image` | Permanently delete an image by id. |
| `sign_url` | Mint a time-limited signed URL for a private image. |
| `optimize_image` | Compress, resize and convert a **local** image file on this machine (no API key, nothing uploaded). Writes `<name>.optimized.<ext>`; never makes a file bigger. |
| `transform_image` | Build an on-the-fly transform URL (resize, crop, format, AI background removal, effects). |
| `upload_video` | Upload a local MP4 `path` (direct path up to 100 MB) or securely import `source_url`. Supports privacy, TTL, metadata, folder, collection, social optimization, private URL expiry, and idempotency. |
| `list_videos` / `get_video` | Discover videos or resume from a stable asset ID; returns current job state and only artifact URLs that exist. |
| `optimize_video` / `enrich_video` | Start asynchronous social optimization or transcript/storyboard enrichment. Returns asset/job IDs immediately by default; optional bounded wait never cancels a timed-out server job. |
| `update_video` / `sign_video_url` / `delete_video` | Update organization/metadata, mint fresh private original/artifact URLs, or delete the video and derivatives. |
| `upload_audio` | Host a local MP3/WAV/M4A/OGG `path` or securely import `source_url`. Supports privacy, TTL, metadata, folder, collection, private URL expiry, and idempotency. |
| `enrich_audio` | Start/resume transcription by `aud_` ID. Return IDs immediately or use bounded polling for text, WebVTT, and timestamped JSON. |
| `list_audio` / `get_audio` | Discover audio, transcription status/artifacts, and detected media metadata by stable `aud_` ID. |
| `update_audio` / `sign_audio_url` / `delete_audio` | Update organization/metadata, mint fresh private original/transcript URLs, or delete audio and artifacts. |
| `list_custom_domains` | List domains on the active project, DNS/certificate readiness, required records, and account plan capacity. |
| `create_custom_domain` / `refresh_custom_domain` / `delete_custom_domain` | Attach a customer-owned hostname, re-check readiness after DNS changes, or remove it. Canonical URLs keep working after removal. |

Image CDN URLs support on-the-fly transforms via query params — see the
[transforms docs](https://pixelvault.dev/docs/transforms/). PDFs are download-only attachments and do not support transforms.
Media API results keep canonical `url` and include optional `branded_url` when the active project has a ready custom domain. Use the returned branded value; do not rebuild signed links.

### Resume-safe video workflow

1. Call `upload_video` with `path` or `source_url`, an `idempotency_key`, and the intended `visibility`.
2. Call `enrich_video` with the returned `id` and `wait: false`. Persist `id` and `enrichment.job_id` immediately.
3. After interruption or in a later turn, call `get_video` with the asset ID. Poll while status is `pending` or `processing`.
4. On `complete`, return `original_url` plus the transcript/storyboard entries present in `enrichment`. On `failed`, return its safe error. For private videos, call `sign_video_url` when fresh bearer URLs are needed.

### Audio transcription workflow

1. Call `upload_audio` with a local `path` or public `source_url`, optional lifecycle fields, and an `idempotency_key`.
2. Persist the returned stable `aud_` ID. Call `enrich_audio` with `wait: false` and persist `enrichment.job_id`.
3. Resume with `get_audio`; while status is `pending` or `processing`, wait and call it again. Or call `enrich_audio` with `wait: true` and a bounded `timeout_seconds`.
4. On `complete`, return the original plus available text, WebVTT, and timestamped JSON URLs. Use `sign_audio_url` to refresh all private URLs.

Audio originals and enrichment sources have an approved global maximum of 25,000,000 bytes; enrichment additionally
accepts up to 10 minutes. The file ceiling is not a plan allowance. Audio and video enrichment share the existing
plan allowance. A local wait timeout does not cancel the server job. The original is preserved without transcoding;
editing, conversion, HLS/DASH, summaries, chapters, show notes, promo copy, and storyboards remain unsupported.
Private audio never falls back to a public URL.

Local binary upload intentionally uses the API's direct MP4 route and rejects files over 100 MB before reading them.
Use an official SDK's resumable upload for larger local files. URL imports require a public HTTPS source. Optimization
accepts sources up to 100 MB and 60 seconds; enrichment accepts 1 second through 10 minutes and up to 100 MB. Quota,
unsupported-source, and validation failures preserve the API's machine-readable error code.

### `optimize_image`

Runs entirely locally with [`sharp`](https://sharp.pixelplumbing.com/), an **optional** dependency: if it can't be
installed for your platform the tool returns a `sharp_unavailable` error and every other tool is unaffected. Needs
Node 20.9+. Inputs: `path`, `format` (`keep|webp|avif|jpg|png`, default `keep`), `max_width`/`max_height` (never
upscales), `quality` (default 80), `keep_metadata`, `output_path` or `in_place`, `dry_run`. EXIF/GPS metadata is stripped
by default (orientation is applied first). It refuses to overwrite an existing file (other than `*.optimized.*`), never
follows symlinks, writes atomically, and leaves already-optimal files alone, so it is safe to call repeatedly. The same
engine ships in the [`pixelvault-cli`](https://www.npmjs.com/package/pixelvault-cli) `optimize` command.

## License

MIT
