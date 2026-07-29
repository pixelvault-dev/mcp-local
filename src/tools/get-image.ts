import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolFromError, type ToolResult } from "../result.js";

export const getImageInputSchema = {
  id: z.string().min(1).describe("Image id to fetch, e.g. img_abc123."),
};

/** get_image — fetch metadata for one image by id (GET /v1/images/:id). */
export async function getImage(args: { id: string }): Promise<ToolResult> {
  try {
    const { data } = await apiRequest<{ data: unknown }>({
      method: "GET",
      path: `/v1/images/${encodeURIComponent(args.id)}`,
    });
    return toolOk(data);
  } catch (err) {
    return toolFromError(err);
  }
}
