import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolFromError, type ToolResult } from "../result.js";

export const listImagesInputSchema = {
  page: z.number().int().min(1).optional().describe("Page number (default 1)."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Items per page (default 20, max 100)."),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Only images whose custom metadata contains every key/value given, e.g. {"env":"prod"} ' +
        "(exact match; nested objects match by containment)."
    ),
};

/** list_images — list images in the project (GET /v1/images), paginated. */
export async function listImages(args: { page?: number; per_page?: number; metadata?: Record<string, unknown> }): Promise<ToolResult> {
  try {
    const res = await apiRequest<unknown>({
      method: "GET",
      path: "/v1/images",
      query: {
        page: args.page,
        per_page: args.per_page,
        metadata:
          args.metadata && Object.keys(args.metadata).length > 0
            ? JSON.stringify(args.metadata)
            : undefined,
      },
    });
    return toolOk(res);
  } catch (err) {
    return toolFromError(err);
  }
}
