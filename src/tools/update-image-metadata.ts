import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolOk, toolFromError, type ToolResult } from "../result.js";

export const updateImageMetadataInputSchema = {
  id: z.string().min(1).describe("Image id, e.g. img_abc123."),
  metadata: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe(
      "The full metadata object to store (max 50 top-level keys / 4 KB). It REPLACES the existing " +
        "metadata (not merged), so include every key you want to keep. Pass null to clear it."
    ),
};

/** update_image_metadata — replace an image's custom metadata (PATCH /v1/images/:id). */
export async function updateImageMetadata(args: {
  id: string;
  metadata: Record<string, unknown> | null;
}): Promise<ToolResult> {
  try {
    const res = await apiRequest<{ data: { id: string; metadata: Record<string, unknown> | null } }>({
      method: "PATCH",
      path: `/v1/images/${encodeURIComponent(args.id)}`,
      body: { metadata: args.metadata },
    });
    return toolOk(res.data);
  } catch (err) {
    return toolFromError(err);
  }
}
