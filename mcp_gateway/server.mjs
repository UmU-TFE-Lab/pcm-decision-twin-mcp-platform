#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.resolve(ROOT, ".runtime", "mcp-runs");
const PORT = Number(process.env.MCP_GATEWAY_PORT || 8787);
const HOST = process.env.MCP_GATEWAY_HOST || "127.0.0.1";
const ALLOWED_ORIGINS = new Set(
  (process.env.MCP_GATEWAY_CORS_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const MAX_RUNS = 100;
const MAX_ACTIVE_RUNS = Number(process.env.MCP_GATEWAY_MAX_ACTIVE_RUNS || 2);
const RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_RUNS = Number(process.env.MCP_GATEWAY_RATE_LIMIT_MAX_RUNS || 6);

const runs = new Map();
const subscribers = new Map();
let clientPromise;

function now() {
  return new Date().toISOString();
}

function publicRun(run, includeResult = true) {
  return {
    id: run.id,
    status: run.status,
    execution_mode: "mcp-gateway",
    created_at: run.created_at,
    started_at: run.started_at,
    completed_at: run.completed_at,
    progress_pct: run.progress_pct,
    current_step: run.current_step,
    completed_steps: run.completed_steps,
    tool_trace: run.tool_trace,
    error: run.error,
    report_hash: run.report_hash,
    request: run.request,
    ...(includeResult ? { result: run.result } : {}),
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["mcp_server/server.mjs"],
        cwd: ROOT,
        env: {
          ...process.env,
          PCM_DATASET_PATH: process.env.PCM_DATASET_PATH || path.resolve(ROOT, "pcm_thermal_storage.csv"),
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "pcm-mcp-http-gateway", version: "0.2.0" });
      await client.connect(transport);
      return client;
    })().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

function parseToolResult(result) {
  if (result?.structuredContent && Object.keys(result.structuredContent).length) {
    return result.structuredContent;
  }
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return null;
  return JSON.parse(text);
}

function notify(run, event = "update") {
  const payload = JSON.stringify(publicRun(run));
  for (const response of subscribers.get(run.id) || []) {
    response.write(`event: ${event}\ndata: ${payload}\n\n`);
    if (["completed", "failed", "cancelled"].includes(event)) response.end();
  }
  if (["completed", "failed", "cancelled"].includes(event)) subscribers.delete(run.id);
}

function updateRun(run, patch, event = "update") {
  Object.assign(run, patch);
  notify(run, event);
}

function persistRun(run) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, `${run.id}.json`), JSON.stringify(publicRun(run), null, 2));
}

function trimRuns() {
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return firstForwarded?.trim() || request.socket.remoteAddress || "unknown";
}

function consumeRunQuota(buckets, key, windowMs, maxRuns) {
  const timestamp = Date.now();
  const existing = buckets.get(key);
  const bucket = !existing || timestamp >= existing.resetAt
    ? { count: 0, resetAt: timestamp + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: bucket.count <= maxRuns,
    remaining: Math.max(0, maxRuns - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000)),
  };
}

async function callTool(run, name, args, progressPct, completedSteps = [name]) {
  if (run.status === "cancelled") throw new Error("Run cancelled by user.");
  updateRun(run, { current_step: name, progress_pct: progressPct });
  const startedAt = performance.now();
  const trace = {
    sequence: run.tool_trace.length + 1,
    tool: name,
    arguments: args,
    status: "running",
    started_at: now(),
  };
  run.tool_trace.push(trace);
  notify(run);
  try {
    const client = await getClient();
    const response = await client.callTool({ name, arguments: args });
    const result = parseToolResult(response);
    Object.assign(trace, {
      status: "success",
      completed_at: now(),
      latency_ms: Number((performance.now() - startedAt).toFixed(1)),
      result_summary: summarizeToolResult(name, result),
    });
    run.completed_steps = [...new Set([...run.completed_steps, ...completedSteps])];
    notify(run);
    return result;
  } catch (error) {
    Object.assign(trace, {
      status: "failed",
      completed_at: now(),
      latency_ms: Number((performance.now() - startedAt).toFixed(1)),
      error: error.message,
    });
    notify(run);
    throw error;
  }
}

function summarizeToolResult(name, result) {
  if (!result || typeof result !== "object") return { returned: Boolean(result) };
  if (name === "validate_scenario") {
    return { is_valid: result.is_valid, scenario_support_score: result.scenario_support_score };
  }
  if (name === "explain_prediction") {
    return {
      evidence_records: result.evidence_audit?.nearest_records?.length ?? 0,
      scenario_support_score: result.validation?.scenario_support_score,
    };
  }
  if (name === "run_sensitivity_analysis") return { points: result.sweep?.length ?? 0 };
  if (name === "optimize_pcm_design") return { candidates: result.top_candidates?.length ?? 0 };
  if (name === "generate_decision_package") {
    return { workflow_status: result.workflow_status, report_hash: result.version?.task_hash };
  }
  return { keys: Object.keys(result).slice(0, 12) };
}

async function executeRun(run) {
  const request = run.request;
  const scenario = request.scenario || {};
  const objective = request.objective || "balance";
  const sensitivityVariable = request.sensitivity_variable || "air_temperature_c";
  const sensitivitySteps = Number(request.sensitivity_steps || 7);
  const useFallback = Boolean(request.use_fallback);
  updateRun(run, { status: "running", started_at: now(), current_step: "validate_scenario", progress_pct: 2 });

  try {
    await callTool(run, "validate_scenario", { scenario }, 8);
    await callTool(run, "explain_prediction", {
      scenario,
      evidence_limit: Number(request.evidence_limit || 6),
      use_fallback: useFallback,
    }, 24);
    await callTool(run, "run_sensitivity_analysis", {
      scenario,
      variable: sensitivityVariable,
      steps: sensitivitySteps,
      objective,
    }, 42);
    await callTool(run, "optimize_pcm_design", {
      scenario,
      objective,
      allow_system_change: Boolean(request.allow_system_change),
      limit: 6,
    }, 58);
    const decisionPackage = await callTool(run, "generate_decision_package", {
      scenario,
      objective,
      sensitivity_variable: sensitivityVariable,
      sensitivity_steps: sensitivitySteps,
      evidence_limit: Number(request.evidence_limit || 6),
      use_fallback: useFallback,
      full_analysis: true,
      constraints: request.constraints || {},
      task_text: request.task || "",
    }, 72, [
      "generate_decision_package",
      "multi_variable_sensitivity",
      "constraint_filter",
      "counterfactual_recommendation",
      "benchmark_update",
    ]);
    const reportHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ request, decisionPackage }))
      .digest("hex");
    updateRun(run, {
      status: "completed",
      completed_at: now(),
      current_step: "completed",
      progress_pct: 100,
      result: decisionPackage,
      report_hash: reportHash,
    }, "completed");
    persistRun(run);
  } catch (error) {
    const status = run.status === "cancelled" ? "cancelled" : "failed";
    updateRun(run, {
      status,
      completed_at: now(),
      current_step: status,
      error: error.message,
    }, status);
    persistRun(run);
  }
}

function createRun(request) {
  const run = {
    id: crypto.randomUUID(),
    status: "queued",
    created_at: now(),
    started_at: null,
    completed_at: null,
    progress_pct: 0,
    current_step: "queued",
    completed_steps: [],
    tool_trace: [],
    error: null,
    report_hash: null,
    request,
    result: null,
  };
  runs.set(run.id, run);
  trimRuns();
  setImmediate(() => executeRun(run));
  return run;
}

async function capabilities() {
  const client = await getClient();
  const [tools, resources, prompts] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listPrompts(),
  ]);
  return {
    tools: tools.tools.map((item) => item.name),
    resources: resources.resources.map((item) => item.uri),
    prompts: prompts.prompts.map((item) => item.name),
  };
}

export function createGatewayServer({
  maxActiveRuns = MAX_ACTIVE_RUNS,
  rateLimitWindowMs = RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRuns = RATE_LIMIT_MAX_RUNS,
} = {}) {
  const runRateLimits = new Map();
  return http.createServer(async (request, response) => {
    const headers = corsHeaders(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          status: "ok",
          service: "pcm-mcp-gateway",
          transport: "stdio",
          limits: {
            max_active_runs: maxActiveRuns,
            run_requests_per_window: rateLimitMaxRuns,
            rate_limit_window_ms: rateLimitWindowMs,
          },
        }, headers);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/mcp/capabilities") {
        json(response, 200, await capabilities(), headers);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/agent/runs") {
        json(response, 200, [...runs.values()].slice(-25).reverse().map((run) => publicRun(run, false)), headers);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/agent/runs") {
        const quota = consumeRunQuota(
          runRateLimits,
          requestIp(request),
          rateLimitWindowMs,
          rateLimitMaxRuns,
        );
        if (!quota.allowed) {
          json(response, 429, { detail: "Agent workflow rate limit exceeded. Try again later." }, {
            ...headers,
            "Retry-After": String(quota.retryAfterSeconds),
            "X-RateLimit-Limit": String(rateLimitMaxRuns),
            "X-RateLimit-Remaining": "0",
          });
          return;
        }
        const activeRuns = [...runs.values()].filter((run) => ["queued", "running"].includes(run.status)).length;
        if (activeRuns >= maxActiveRuns) {
          json(response, 429, { detail: "Agent workflow capacity is currently full. Try again shortly." }, {
            ...headers,
            "Retry-After": "15",
            "X-RateLimit-Limit": String(rateLimitMaxRuns),
            "X-RateLimit-Remaining": String(quota.remaining),
          });
          return;
        }
        const payload = await readJson(request);
        const run = createRun(payload);
        json(response, 202, publicRun(run, false), {
          ...headers,
          "X-RateLimit-Limit": String(rateLimitMaxRuns),
          "X-RateLimit-Remaining": String(quota.remaining),
        });
        return;
      }

      const match = url.pathname.match(/^\/api\/v1\/agent\/runs\/([0-9a-f-]+)(?:\/(events|cancel))?$/);
      if (match) {
        const run = runs.get(match[1]);
        if (!run) {
          json(response, 404, { detail: "Run not found." }, headers);
          return;
        }
        if (request.method === "GET" && match[2] === "events") {
          response.writeHead(200, {
            ...headers,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });
          response.write(`event: snapshot\ndata: ${JSON.stringify(publicRun(run))}\n\n`);
          if (["completed", "failed", "cancelled"].includes(run.status)) {
            response.end();
            return;
          }
          if (!subscribers.has(run.id)) subscribers.set(run.id, new Set());
          subscribers.get(run.id).add(response);
          const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
          request.on("close", () => {
            clearInterval(heartbeat);
            subscribers.get(run.id)?.delete(response);
          });
          return;
        }
        if (request.method === "POST" && match[2] === "cancel") {
          if (!["completed", "failed", "cancelled"].includes(run.status)) {
            updateRun(run, { status: "cancelled", completed_at: now(), current_step: "cancelled" }, "cancelled");
            persistRun(run);
          }
          json(response, 200, publicRun(run), headers);
          return;
        }
        if (request.method === "GET" && !match[2]) {
          json(response, 200, publicRun(run), headers);
          return;
        }
      }
      json(response, 404, { detail: "Not found." }, headers);
    } catch (error) {
      json(response, 500, { detail: error.message }, headers);
    }
  });
}

export async function startGateway({ host = HOST, port = PORT, ...options } = {}) {
  const server = createGatewayServer(options);
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

export async function closeGateway(server) {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (clientPromise) {
    const client = await clientPromise.catch(() => null);
    await client?.close();
    clientPromise = undefined;
  }
  subscribers.clear();
  runs.clear();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = await startGateway();
  process.stdout.write(`PCM MCP Gateway listening at http://${HOST}:${PORT}\n`);
  const shutdown = async () => {
    await closeGateway(server);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
