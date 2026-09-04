import assert from "node:assert/strict";
import test from "node:test";
import { closeGateway, startGateway } from "../../mcp_gateway/server.mjs";
import { TEST_SCENARIO } from "../helpers/loadRows.mjs";

async function waitForRun(baseUrl, runId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/agent/runs/${runId}`);
    const run = await response.json();
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gateway run ${runId} did not finish within ${timeoutMs} ms.`);
}

test("HTTP gateway executes a real MCP workflow and persists an audit hash", async (t) => {
  const server = await startGateway({ host: "127.0.0.1", port: 0 });
  t.after(async () => closeGateway(server));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.transport, "stdio");

  const capabilities = await fetch(`${baseUrl}/api/v1/mcp/capabilities`).then((response) => response.json());
  assert.equal(capabilities.tools.length, 18);
  assert.equal(capabilities.resources.length, 4);
  assert.equal(capabilities.prompts.length, 3);

  const createdResponse = await fetch(`${baseUrl}/api/v1/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "Review the scenario and maximize efficiency.",
      scenario: TEST_SCENARIO,
      objective: "efficiency",
      sensitivity_variable: "solar_irradiance_wm2",
      sensitivity_steps: 5,
      evidence_limit: 6,
    }),
  });
  assert.equal(createdResponse.status, 202);
  const created = await createdResponse.json();
  const run = await waitForRun(baseUrl, created.id);

  assert.equal(run.status, "completed");
  assert.equal(run.execution_mode, "mcp-gateway");
  assert.equal(run.tool_trace.length, 5);
  assert.ok(run.tool_trace.every((entry) => entry.status === "success"));
  assert.match(run.report_hash, /^[a-f0-9]{64}$/);
  assert.equal(run.result.workflow_status, "completed");
  assert.equal(run.result.prediction_explanation.evidence_audit.nearest_records.length, 6);
});

test("HTTP gateway rejects workflow submissions above the per-IP limit", async (t) => {
  const server = await startGateway({
    host: "127.0.0.1",
    port: 0,
    maxActiveRuns: 10,
    rateLimitMaxRuns: 0,
  });
  t.after(async () => closeGateway(server));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
  assert.match((await response.json()).detail, /rate limit/i);
});

test("HTTP gateway rejects workflow submissions when capacity is full", async (t) => {
  const server = await startGateway({
    host: "127.0.0.1",
    port: 0,
    maxActiveRuns: 0,
    rateLimitMaxRuns: 6,
  });
  t.after(async () => closeGateway(server));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "15");
  assert.match((await response.json()).detail, /capacity/i);
});
