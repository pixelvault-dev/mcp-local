# @pixelvault-dev/local-mcp

A **local (stdio) MCP server** for [PixelVault](https://pixelvault.dev) — agent-first media hosting.

The difference from the hosted MCP server (`mcp.pixelvault.dev`): this one runs on
**your** machine, so it can upload a local image, PDF, or MP4 by path. It reads the
bytes off disk and sends them directly to the API; the file is never base64-encoded
into the model's context. That keeps media bytes and slow, token-hungry base64
round-trips out of the conversation.

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

Image CDN URLs support on-the-fly transforms via query params — see the
[transforms docs](https://pixelvault.dev/docs#transforms). PDFs are download-only attachments and do not support transforms.

### Resume-safe video workflow

1. Call `upload_video` with `path` or `source_url`, an `idempotency_key`, and the intended `visibility`.
2. Call `enrich_video` with the returned `id` and `wait: false`. Persist `id` and `enrichment.job_id` immediately.
3. After interruption or in a later turn, call `get_video` with the asset ID. Poll while status is `pending` or `processing`.
4. On `complete`, return `original_url` plus the transcript/storyboard entries present in `enrichment`. On `failed`, return its safe error. For private videos, call `sign_video_url` when fresh bearer URLs are needed.

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
