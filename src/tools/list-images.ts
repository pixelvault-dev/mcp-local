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
};

/** list_images — list images in the project (GET /v1/images), paginated. */
export async function listImages(args: { page?: number; per_page?: number }): Promise<ToolResult> {
  try {
    const res = await apiRequest<unknown>({
      method: "GET",
      path: "/v1/images",
      query: { page: args.page, per_page: args.per_page },
    });
    return toolOk(res);
  } catch (err) {
    return toolFromError(err);
  }
}
