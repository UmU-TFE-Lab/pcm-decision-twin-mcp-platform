import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { generateDecisionPackage } from "../src/agentWorkflow.js";
import { clearAnalyticsCache } from "../src/analytics.js";
import { closeGateway, startGateway } from "../mcp_gateway/server.mjs";
import { loadRows } from "../mcp_server/dataLoader.mjs";
import {
  diagnoseAndRecommend,
  generateReport,
  getDefaultScenario,
  predictTwinState,
} from "../mcp_server/tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(ROOT, "benchmarks", "results", "platform-performance-latest.json");

function timeCall(fn, iterations = 1) {
  const times = [];
  let last;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    last = fn();
    times.push(performance.now() - start);
  }
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { mean_ms: Number(mean.toFixed(2)), p95_ms: Number(p95.toFixed(2)), last };
}

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const fullPath = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? dirSizeBytes(fullPath) : fs.statSync(fullPath).size);
  }, 0);
}

async function waitForRun(baseUrl, id, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await fetch(`${baseUrl}/api/v1/agent/runs/${id}`).then((response) => response.json());
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Gateway performance run ${id} timed out.`);
}

async function timeGatewayRun(baseUrl, payload) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/v1/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const created = await response.json();
  const run = await waitForRun(baseUrl, created.id);
  if (run.status !== "completed") throw new Error(run.error || "Gateway performance run failed.");
  return {
    latency_ms: Number((performance.now() - started).toFixed(2)),
    mcp_calls: run.tool_trace.length,
    report_hash_present: /^[a-f0-9]{64}$/.test(run.report_hash),
  };
}

const coldLoad = timeCall(() => loadRows(), 1);
const rows = coldLoad.last;
const cachedLoad = timeCall(() => loadRows(), 100);
const scenario = getDefaultScenario();

clearAnalyticsCache(rows);
const predictionCold = timeCall(() => predictTwinState({ scenario, limit: 220, evidence_limit: 5 }), 1);
const predictionWarm = timeCall(() => predictTwinState({ scenario, limit: 220, evidence_limit: 5 }), 40);
const report = timeCall(() => generateReport({ scenario }), 20);
const diagnosis = timeCall(() => diagnoseAndRecommend({ scenario }), 20);

clearAnalyticsCache(rows);
const packageConfig = {
  task_text: "Validate, explain, scan, optimize, and report the default PCM scenario.",
  objective: "balance",
  sensitivity_variable: "air_temperature_c",
  sensitivity_steps: 7,
  evidence_limit: 6,
  full_analysis: true,
};
const decisionPackageCold = timeCall(() => generateDecisionPackage(rows, scenario, packageConfig), 1);
const decisionPackageWarm = timeCall(() => generateDecisionPackage(rows, scenario, packageConfig), 5);

const gateway = await startGateway({ host: "127.0.0.1", port: 0 });
const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
let gatewayFirst;
let gatewayRepeat;
try {
  const payload = {
    task: packageConfig.task_text,
    scenario,
    objective: packageConfig.objective,
    sensitivity_variable: packageConfig.sensitivity_variable,
    sensitivity_steps: packageConfig.sensitivity_steps,
    evidence_limit: packageConfig.evidence_limit,
  };
  gatewayFirst = await timeGatewayRun(gatewayUrl, payload);
  gatewayRepeat = await timeGatewayRun(gatewayUrl, payload);
} finally {
  await closeGateway(gateway);
}

const result = {
  benchmark: "pcm_platform_local_performance",
  version: "0.2.0",
  generated_at: new Date().toISOString(),
  environment: {
    runtime: "local_node_runtime",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  dataset_rows: rows.length,
  frontend_dist_size_kb: Number((dirSizeBytes(DIST) / 1024).toFixed(1)),
  dataset_cold_load_ms: coldLoad.mean_ms,
  dataset_cached_load_mean_ms: cachedLoad.mean_ms,
  prediction_cold_ms: predictionCold.mean_ms,
  prediction_warm_mean_ms: predictionWarm.mean_ms,
  prediction_warm_p95_ms: predictionWarm.p95_ms,
  report_generation_warm_mean_ms: report.mean_ms,
  report_generation_warm_p95_ms: report.p95_ms,
  diagnosis_workflow_warm_mean_ms: diagnosis.mean_ms,
  diagnosis_workflow_warm_p95_ms: diagnosis.p95_ms,
  decision_package_cold_ms: decisionPackageCold.mean_ms,
  decision_package_warm_mean_ms: decisionPackageWarm.mean_ms,
  decision_package_warm_p95_ms: decisionPackageWarm.p95_ms,
  gateway_first_run: gatewayFirst,
  gateway_repeat_run: gatewayRepeat,
  scope: "Single-process local prototype; not a concurrency or public-cloud benchmark.",
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
