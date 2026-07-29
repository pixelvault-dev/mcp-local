import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolFromError, type ToolResult } from "../result.js";

export const deleteImageInputSchema = {
  id: z.string().min(1).describe("Image id to delete, e.g. img_abc123."),
};

/** delete_image — permanently delete one image by id (DELETE /v1/images/:id). */
export async function deleteImage(args: { id: string }): Promise<ToolResult> {
  try {
    await apiRequest<unknown>({
      method: "DELETE",
      path: `/v1/images/${encodeURIComponent(args.id)}`,
    });
    return toolOk({ deleted: true, id: args.id });
  } catch (err) {
    return toolFromError(err);
  }
}
