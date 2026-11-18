import { z } from "zod";
import { apiRequest } from "../client.js";
import { toolFromError, toolOk, type ToolResult } from "../result.js";

export const listCustomDomainsInputSchema = {};
export const createCustomDomainInputSchema = {
  hostname: z.string().min(1).describe("Customer-owned hostname, for example media.example.com."),
};
export const customDomainIdInputSchema = {
  id: z.string().min(1).describe("Custom-domain id returned by list_custom_domains."),
};

export async function listCustomDomains(): Promise<ToolResult> {
  try {
    return toolOk(await apiRequest({ path: "/v1/custom-domains" }));
  } catch (error) {
    return toolFromError(error);
  }
}

export async function createCustomDomain({ hostname }: { hostname: string }): Promise<ToolResult> {
  try {
    return toolOk(await apiRequest({
      method: "POST",
      path: "/v1/custom-domains",
      body: { hostname },
    }));
  } catch (error) {
    return toolFromError(error);
  }
}

export async function refreshCustomDomain({ id }: { id: string }): Promise<ToolResult> {
  try {
    return toolOk(await apiRequest({
      method: "POST",
      path: `/v1/custom-domains/${encodeURIComponent(id)}/refresh`,
    }));
  } catch (error) {
    return toolFromError(error);
  }
}

export async function deleteCustomDomain({ id }: { id: string }): Promise<ToolResult> {
  try {
    return toolOk(await apiRequest({
      method: "DELETE",
      path: `/v1/custom-domains/${encodeURIComponent(id)}`,
    }));
  } catch (error) {
    return toolFromError(error);
  }
}
