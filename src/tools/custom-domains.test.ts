import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCustomDomain,
  deleteCustomDomain,
  listCustomDomains,
  refreshCustomDomain,
} from "./custom-domains.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("local MCP custom-domain tools", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PIXELVAULT_API_KEY;
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    process.env.PIXELVAULT_API_KEY = "pv_live_test";
    calls = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ data: { id: "dom_1", hostname: "media.example.com", ready: true } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PIXELVAULT_API_KEY;
    else process.env.PIXELVAULT_API_KEY = originalKey;
  });

  it("lists and creates custom domains", async () => {
    const listed = await listCustomDomains();
    expect(listed.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ url: "https://api.pixelvault.dev/v1/custom-domains" });

    await createCustomDomain({ hostname: "media.example.com" });
    expect(calls[1]).toMatchObject({
      url: "https://api.pixelvault.dev/v1/custom-domains",
      init: { method: "POST", body: JSON.stringify({ hostname: "media.example.com" }) },
    });
  });

  it("refreshes and deletes encoded ids", async () => {
    await refreshCustomDomain({ id: "dom/1" });
    expect(calls[0]).toMatchObject({
      url: "https://api.pixelvault.dev/v1/custom-domains/dom%2F1/refresh",
      init: { method: "POST" },
    });

    await deleteCustomDomain({ id: "dom/1" });
    expect(calls[1]).toMatchObject({
      url: "https://api.pixelvault.dev/v1/custom-domains/dom%2F1",
      init: { method: "DELETE" },
    });
  });
});
