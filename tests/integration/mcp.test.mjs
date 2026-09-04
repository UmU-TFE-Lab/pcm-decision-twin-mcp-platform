import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TEST_SCENARIO } from "../helpers/loadRows.mjs";

const ROOT = process.cwd();

function parseResult(response) {
  if (response.structuredContent && Object.keys(response.structuredContent).length) {
    return response.structuredContent;
  }
  return JSON.parse(response.content.find((item) => item.type === "text").text);
}

test("MCP stdio transport exposes the release registry and auditable prediction", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp_server/server.mjs"],
    cwd: ROOT,
    env: { ...process.env, PCM_DATASET_PATH: path.resolve(ROOT, "pcm_thermal_storage.csv") },
    stderr: "pipe",
  });
  const client = new Client({ name: "pcm-integration-test", version: "0.2.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const [tools, resources, prompts] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listPrompts(),
  ]);
  assert.equal(tools.tools.length, 18);
  assert.equal(resources.resources.length, 4);
  assert.equal(prompts.prompts.length, 3);

  const response = await client.callTool({
    name: "explain_prediction",
    arguments: { scenario: TEST_SCENARIO, evidence_limit: 6 },
  });
  const result = parseResult(response);
  const evidence = result.evidence_audit.nearest_records;
  assert.equal(evidence.length, 6);
  assert.ok(evidence.every((item, index) => (
    Number.isFinite(item.normalized_distance) &&
    Number.isFinite(item.weight_pct) &&
    (index === 0 || item.normalized_distance >= evidence[index - 1].normalized_distance)
  )));
});

test("MCP schema rejects malformed prediction input", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp_server/server.mjs"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "pcm-malformed-test", version: "0.2.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const response = await client.callTool({
    name: "explain_prediction",
    arguments: { evidence_limit: 0 },
  });
  assert.equal(response.isError, true);
  assert.match(response.content.find((item) => item.type === "text").text, /scenario|required|invalid/i);
});
