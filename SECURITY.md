# Security Policy

## Reporting a vulnerability

Please report security issues privately to **hello@pixelvault.dev**, or via GitHub's
[private vulnerability reporting](https://github.com/pixelvault-dev/mcp-local/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

We aim to acknowledge reports within a few business days.

## Handling your API key

This server reads your PixelVault API key from the `PIXELVAULT_API_KEY` environment
variable or `~/.pixelvault/config.json`. The key is sent only to the configured
PixelVault API (`https://api.pixelvault.dev` by default) as a Bearer token over HTTPS.
It is never logged. On the stdio transport, all diagnostic output goes to stderr so a
key can't leak into the protocol stream on stdout.

Treat a `pv_live_…` key like a password: don't commit it, and prefer a scoped/rotatable
key where possible.
