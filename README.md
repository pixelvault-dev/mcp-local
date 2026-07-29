# pixelvault-mcp

A **local (stdio) MCP server** for [PixelVault](https://pixelvault.dev) — agent-first image hosting.

The difference from the hosted MCP server (`mcp.pixelvault.dev`): this one runs on
**your** machine, so it can upload a **local file by path**. It reads the bytes off
disk and streams them to the API as `multipart/form-data` — the file is never
base64-encoded into the model's context. That keeps large images (and slow,
token-hungry base64 round-trips) out of the conversation.

Use the hosted server when your client is remote (ChatGPT, etc.); use this one for
local coding agents that have files on disk.

## Install

Runs with `npx` — no global install needed:

```bash
npx pixelvault-mcp
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
      "args": ["-y", "pixelvault-mcp"],
      "env": { "PIXELVAULT_API_KEY": "pv_live_xxx" }
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `upload_image` | Upload by local **`path`** (streamed, no base64), or `source_url`, or `data`. Optional `folder`, `visibility`, `expires_in`. |
| `list_images` | List images in your project (paginated). |
| `get_image` | Metadata for one image by id. |
| `delete_image` | Permanently delete an image by id. |
| `sign_url` | Mint a time-limited signed URL for a private image. |
| `transform_image` | Build an on-the-fly transform URL (resize, crop, format, AI background removal, effects). |

Every returned CDN URL supports on-the-fly transforms via query params — see the
[transforms docs](https://pixelvault.dev/docs#transforms).

## License

MIT
