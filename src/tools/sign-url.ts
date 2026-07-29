import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolFromError, type ToolResult } from "../result.js";

export const signUrlInputSchema = {
  id: z.string().min(1).describe("Image id to mint a signed URL for, e.g. img_abc123."),
  expires_in: z
    .number()
    .int()
    .min(60)
    .max(2592000)
    .optional()
    .describe("Signature lifetime in seconds (60–2,592,000). Default 3600 (1 hour)."),
};

/**
 * sign_url — mint a time-limited signed URL for a private image
 * (POST /v1/images/:id/sign-url). The signature binds the image, so the URL
 * can't be replayed against another; strip it and the CDN returns 403.
 */
export async function signUrl(args: { id: string; expires_in?: number }): Promise<ToolResult> {
  try {
    const res = await apiRequest<{ data: unknown }>({
      method: "POST",
      path: `/v1/images/${encodeURIComponent(args.id)}/sign-url`,
      body: args.expires_in !== undefined ? { expires_in: args.expires_in } : {},
    });
    return toolOk(res.data);
  } catch (err) {
    return toolFromError(err);
  }
}
