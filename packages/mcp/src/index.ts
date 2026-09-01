import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MdOpsApiError, MdOpsClient } from "./client.js";

const logicalPath = z.string().min(3).max(1024).refine((value) => value.includes("/") && !value.includes("\\") && !value.includes(".."), "Use a safe root-id/relative-path logical path");
const rootId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorText(error: unknown) {
  const message = error instanceof MdOpsApiError ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ""}` : error instanceof Error ? error.message : "MD Ops request failed";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createServer(client: MdOpsClient, writeEnabled: boolean): McpServer {
  const server = new McpServer({ name: "md-ops", version: "0.1.0" });

  server.registerTool("md_ops_list_roots", {
    title: "List Markdown roots",
    description: "List configured logical Markdown roots. Physical filesystem paths are never returned.",
    inputSchema: {},
  }, async () => {
    try { return text({ roots: await client.listRoots() }); } catch (error) { return errorText(error); }
  });

  server.registerTool("md_ops_list_files", {
    title: "List files",
    description: "List files and folders under one logical Markdown root.",
    inputSchema: { root: rootId },
  }, async ({ root }) => {
    try { return text(await client.listFiles(root)); } catch (error) { return errorText(error); }
  });

  server.registerTool("md_ops_search", {
    title: "Search Markdown",
    description: "Search Markdown content within one logical root. Read a file before editing it.",
    inputSchema: { root: rootId, query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).optional() },
  }, async ({ root, query, limit }) => {
    try { return text(await client.search(root, query, limit)); } catch (error) { return errorText(error); }
  });

  server.registerTool("md_ops_retrieve", {
    title: "Retrieve ranked Markdown notes",
    description: "Use QMD keyword retrieval for a small ranked shortlist from one configured root. Returns canonical logical paths, short excerpts, scores, and browser links. Read selected files with md_ops_read_file.",
    inputSchema: { root: rootId, query: z.string().min(1).max(500), limit: z.number().int().min(1).max(8).optional() },
  }, async ({ root, query, limit }) => {
    try { return text(await client.retrieve(root, query, limit)); } catch (error) { return errorText(error); }
  });

  server.registerTool("md_ops_read_file", {
    title: "Read Markdown file",
    description: "Read one logical Markdown file and return its content, ETag, and a browser deep link in read view.",
    inputSchema: { path: logicalPath },
  }, async ({ path }) => {
    try { return text(await client.readFile(path)); } catch (error) { return errorText(error); }
  });

  if (writeEnabled) {
    server.registerTool("md_ops_write_file", {
      title: "Write Markdown file",
      description: "Create or conditionally update one Markdown file. Requires confirm_write=true. Use the ETag from a prior read for an update. Returns a browser deep link that can be sent to the user.",
      inputSchema: { path: logicalPath, content: z.string().max(2_000_000), etag: z.string().min(1).max(500).optional(), confirm_write: z.literal(true) },
    }, async ({ path, content, etag }) => {
      try { return text(await client.writeFile(path, content, etag)); } catch (error) { return errorText(error); }
    });
  }

  return server;
}

const client = new MdOpsClient();
const writeEnabled = process.env.MD_OPS_MCP_WRITE_ENABLED === "true";
const server = createServer(client, writeEnabled);
await server.connect(new StdioServerTransport());
