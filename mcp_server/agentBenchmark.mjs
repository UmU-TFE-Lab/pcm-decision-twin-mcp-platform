import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadRows } from "./dataLoader.mjs";

const ROOT = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, "release_manifest.json"), "utf8"));

const baseScenario = {
  system_type: "BuildingEnvelope",
  pcm_type: "Organic_Paraffin",
  encapsulation_type: "ShapeStabilized",
};

const contextSupportedScenarios = Array.from({ length: 10 }, (_, index) => ({
  group: "building_envelope_context_supported",
  scenario: {
    ...baseScenario,
    air_temperature_c: 16 + index * 1.2,
    inlet_fluid_temp_c: 20 + index * 0.9,
    solar_irradiance_wm2: 80 + index * 55,
    cycle_number: 250 + index * 120,
  },
}));

const extensionSystems = ["SolarTES", "HVACStorage"];
const scenarioExtensionCases = Array.from({ length: 10 }, (_, index) => ({
  group: "scenario_extension",
  scenario: {
    system_type: extensionSystems[index % extensionSystems.length],
    pcm_type: index % 3 === 0 ? "Eutectic" : "Organic_Paraffin",
    encapsulation_type: index % 2 === 0 ? "Macro" : "Micro",
    air_temperature_c: 12 + index * 1.8,
    inlet_fluid_temp_c: 24 + index * 1.1,
    solar_irradiance_wm2: 180 + index * 70,
    cycle_number: 500 + index * 140,
  },
}));

const batteryStressCases = Array.from({ length: 10 }, (_, index) => ({
  group: "battery_high_cycle_stress",
  scenario: {
    system_type: "BatteryCooling",
    pcm_type: index % 2 === 0 ? "Inorganic_SaltHydrate" : "Organic_Paraffin",
    encapsulation_type: index % 3 === 0 ? "Micro" : "ShapeStabilized",
    air_temperature_c: 25 + index * 1.3,
    inlet_fluid_temp_c: 28 + index * 0.8,
    solar_irradiance_wm2: 0,
    mass_flow_rate_kgs: 0.08 + index * 0.015,
    cycle_number: 1900 + index * 120,
  },
}));

const lowSocCases = Array.from({ length: 5 }, (_, index) => ({
  group: "low_soc_stress",
  scenario: {
    system_type: index % 2 === 0 ? "BuildingEnvelope" : "HVACStorage",
    pcm_type: index % 2 === 0 ? "Inorganic_SaltHydrate" : "Eutectic",
    encapsulation_type: index % 3 === 0 ? "Macro" : "Micro",
    air_temperature_c: 4 + index,
    inlet_fluid_temp_c: 6 + index,
    solar_irradiance_wm2: 0,
    mass_flow_rate_kgs: 0.05 + index * 0.005,
    cycle_number: 300 + index * 60,
  },
}));

const malformedCases = Array.from({ length: 5 }, (_, index) => ({
  group: "malformed_input",
  scenario: {
    ...baseScenario,
    cycle_number: 100 + index * 10,
  },
  invalidArguments: { limit: 10 },
}));

const outOfDomainCases = Array.from({ length: 5 }, (_, index) => ({
  group: "out_of_domain_fallback",
  scenario: {
    system_type: "UnsupportedSystem",
    pcm_type: index % 2 === 0 ? "UnknownPCM" : "Organic_Paraffin",
    encapsulation_type: "UnsupportedEncapsulation",
    air_temperature_c: -15 + index * 12,
    inlet_fluid_temp_c: 5 + index * 10,
    solar_irradiance_wm2: 950 + index * 40,
    cycle_number: 2800 + index * 80,
  },
}));

const benchmarkCases = [
  ...contextSupportedScenarios,
  ...scenarioExtensionCases,
  ...batteryStressCases,
  ...lowSocCases,
  ...malformedCases,
  ...outOfDomainCases,
];

function mean(rows, column) {
  const values = rows.map((row) => row[column]).filter(Number.isFinite);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value, min, max) {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function groupCandidateRows(rows, scenario) {
  const climateMatch = rows.filter((row) => {
    const air = Math.abs(row.air_temperature_c - scenario.air_temperature_c) < 4;
    const inlet = Math.abs(row.inlet_fluid_temp_c - scenario.inlet_fluid_temp_c) < 5;
    const solar = Math.abs(row.solar_irradiance_wm2 - scenario.solar_irradiance_wm2) < 160;
    return row.system_type === scenario.system_type && air && inlet && solar;
  });
  const systemRows = rows.filter((row) => row.system_type === scenario.system_type);
  const pool = climateMatch.length >= 250 ? climateMatch : systemRows;
  const groups = new Map();
  pool.forEach((row) => {
    const key = `${row.pcm_type} | ${row.encapsulation_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    efficiency: mean(groupRows, "thermal_storage_efficiency_pct"),
    stored: mean(groupRows, "stored_energy_kj"),
    loss: mean(groupRows, "energy_loss_pct"),
    soc: mean(groupRows, "state_of_charge_pct"),
  }));
}

function recommendationRanking(rows, scenario, scale = {}) {
  const weights = {
    efficiency: 0.36 * (scale.efficiency ?? 1),
    stored: 0.28 * (scale.stored ?? 1),
    soc: 0.22 * (scale.soc ?? 1),
    loss: 0.14 * (scale.loss ?? 1),
  };
  return groupCandidateRows(rows, scenario)
    .map((group) => ({
      key: group.key,
      score:
        normalize(group.efficiency, 35, 98) * weights.efficiency +
        normalize(group.stored, 0, 18000) * weights.stored +
        normalize(group.soc, 0, 100) * weights.soc -
        normalize(group.loss, 2, 35) * weights.loss,
    }))
    .sort((a, b) => b.score - a.score);
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function evaluateRecommendationStability(rows, cases) {
  const perturbations = [
    { efficiency: 1.1 },
    { stored: 1.1 },
    { soc: 1.1 },
    { loss: 1.1 },
    { efficiency: 0.9, stored: 1.1, soc: 1.1, loss: 0.9 },
  ];
  const evaluable = cases.filter((item) => (
    item.group !== "malformed_input" &&
    item.group !== "out_of_domain_fallback" &&
    recommendationRanking(rows, item.scenario).length >= 3
  ));
  const results = evaluable.map((item) => {
    const base = recommendationRanking(rows, item.scenario);
    const baseTop1 = base[0]?.key;
    const baseTop3 = base.slice(0, 3).map((entry) => entry.key);
    const perturbed = perturbations.map((scale) => recommendationRanking(rows, item.scenario, scale));
    return {
      top1Stable: perturbed.every((ranking) => ranking[0]?.key === baseTop1),
      top3Stable: perturbed.every((ranking) => sameSet(ranking.slice(0, 3).map((entry) => entry.key), baseTop3)),
    };
  });
  return {
    top1Stable: `${results.filter((item) => item.top1Stable).length}/${results.length}`,
    top3Stable: `${results.filter((item) => item.top3Stable).length}/${results.length}`,
  };
}

function hasRiskWarning(diagnostics = []) {
  return diagnostics.some((item) => (
    /Risk|Warning/i.test(item.level ?? "") &&
    /cycle|loss|degradation|state of charge|phase/i.test(`${item.title ?? ""} ${item.detail ?? ""}`)
  ));
}

function hasFallbackWarning(diagnostics = []) {
  return diagnostics.some((item) => (
    /Warning/i.test(item.level ?? "") &&
    /unsupported category|fallback evidence|direct validation|exact material/i.test(`${item.title ?? ""} ${item.detail ?? ""}`)
  ));
}

function hasLowSocWarning(diagnostics = []) {
  return diagnostics.some((item) => (
    /Warning|Risk/i.test(item.level ?? "") &&
    /low state of charge|stored thermal capacity|charge reserve/i.test(`${item.title ?? ""} ${item.detail ?? ""}`)
  ));
}

function evidenceDistancesOrdered(nearestEvidence = []) {
  const distances = nearestEvidence.map((item) => item.distance);
  return distances.length > 0 &&
    distances.every(Number.isFinite) &&
    distances.every((value, index) => index === 0 || value >= distances[index - 1]);
}

function evaluateExpertRuleAgreement(results) {
  const checks = [
    ...results
      .filter((item) => item.group === "building_envelope_context_supported")
      .slice(0, 5)
      .map((item) => item.task_completion && item.fallback_correct && item.evidence_complete),
    ...results
      .filter((item) => item.group === "scenario_extension")
      .slice(0, 5)
      .map((item) => item.task_completion && item.fallback_correct && item.evidence_complete),
    ...results
      .filter((item) => item.group === "battery_high_cycle_stress" && item.risk_warning_correct !== null)
      .slice(0, 5)
      .map((item) => item.task_completion && item.risk_warning_correct),
    ...results
      .filter((item) => item.group === "low_soc_stress")
      .slice(0, 5)
      .map((item) => item.task_completion && item.low_soc_warning_correct),
    ...results
      .filter((item) => item.group === "out_of_domain_fallback")
      .slice(0, 5)
      .map((item) => item.fallback_correct && item.fallback_warning_success),
  ];
  return `${checks.filter(Boolean).length}/${checks.length}`;
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["mcp_server/server.mjs"],
  cwd: process.cwd(),
  stderr: "pipe",
});

const client = new Client({ name: "pcm-mcp-agent-benchmark", version: "0.2.0" });
await client.connect(transport);

async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  return {
    label,
    latency_ms: Number((performance.now() - start).toFixed(1)),
    result,
  };
}

function parseTool(response) {
  return JSON.parse(response.content[0].text);
}

function stableReportHash(report) {
  const normalized = { ...report, generated_at: "<normalized>" };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

const discovery = {
  tools: await timed("tool_discovery", () => client.listTools()),
  resources: await timed("resource_discovery", () => client.listResources()),
  prompts: await timed("prompt_discovery", () => client.listPrompts()),
};

const caseResults = [];

for (const [index, item] of benchmarkCases.entries()) {
  const caseId = `${item.group}_${String(index + 1).padStart(2, "0")}`;
  if (item.group === "malformed_input") {
    const invalid = await timed(caseId, () => client.callTool({
      name: "predict_twin_state",
      arguments: { scenario: item.scenario, ...item.invalidArguments },
    }));
    caseResults.push({
      case_id: caseId,
      group: item.group,
      task_completion: invalid.result.isError === true,
      invalid_rejection: invalid.result.isError === true,
      fallback_correct: null,
      evidence_complete: null,
      report_reproducible: null,
      risk_warning_correct: null,
      low_soc_warning_correct: null,
      fallback_warning_success: null,
      evidence_distance_ordered: null,
      latency_ms: invalid.latency_ms,
    });
    continue;
  }

  const predictionResponse = await timed(`${caseId}_prediction`, () => client.callTool({
    name: "predict_twin_state",
    arguments: { scenario: item.scenario, evidence_limit: 5 },
  }));
  const diagnosisResponse = await timed(`${caseId}_diagnosis`, () => client.callTool({
    name: "diagnose_and_recommend",
    arguments: { scenario: item.scenario, evidence_limit: 5 },
  }));

  const prediction = parseTool(predictionResponse.result);
  const diagnosis = parseTool(diagnosisResponse.result);
  const isFallbackCase = item.group === "out_of_domain_fallback";
  const expectedRiskWarning = item.group === "battery_high_cycle_stress" && item.scenario.cycle_number > 2000;
  const expectedLowSocWarning = item.group === "low_soc_stress";
  const fallbackCorrect = isFallbackCase
    ? prediction.prediction?.matching_category_rows < 80
    : prediction.prediction?.matching_category_rows >= 80;

  let reportReproducible = null;
  if (index % 4 === 0) {
    const report1 = parseTool((await client.callTool({
      name: "generate_report",
      arguments: { scenario: item.scenario },
    })));
    const report2 = parseTool((await client.callTool({
      name: "generate_report",
      arguments: { scenario: item.scenario },
    })));
    reportReproducible = stableReportHash(report1) === stableReportHash(report2);
  }

  caseResults.push({
    case_id: caseId,
    group: item.group,
    task_completion: Boolean(diagnosis?.prediction && diagnosis?.top_recommendations),
    invalid_rejection: null,
    fallback_correct: fallbackCorrect,
    evidence_complete: (prediction.nearest_evidence?.length ?? 0) >= 5,
    report_reproducible: reportReproducible,
    risk_warning_correct: expectedRiskWarning ? hasRiskWarning(diagnosis.diagnostics) : null,
    low_soc_warning_correct: expectedLowSocWarning ? hasLowSocWarning(diagnosis.diagnostics) : null,
    fallback_warning_success: isFallbackCase ? hasFallbackWarning(diagnosis.diagnostics) : null,
    evidence_distance_ordered: evidenceDistancesOrdered(prediction.nearest_evidence),
    latency_ms: Number((predictionResponse.latency_ms + diagnosisResponse.latency_ms).toFixed(1)),
    data_support_score: prediction.prediction?.data_support_score,
    matching_category_rows: prediction.prediction?.matching_category_rows,
  });
}

const latencies = [
  discovery.tools.latency_ms,
  discovery.resources.latency_ms,
  discovery.prompts.latency_ms,
  ...caseResults.map((item) => item.latency_ms),
];

function count(group, predicate) {
  const items = group ? caseResults.filter((item) => item.group === group) : caseResults;
  return {
    passed: items.filter(predicate).length,
    total: items.length,
  };
}

function ratioText({ passed, total }) {
  return `${passed}/${total}`;
}

const reportChecks = caseResults.filter((item) => item.report_reproducible !== null);
const evidenceChecks = caseResults.filter((item) => item.evidence_complete !== null);
const riskWarningChecks = caseResults.filter((item) => item.risk_warning_correct !== null);
const lowSocWarningChecks = caseResults.filter((item) => item.low_soc_warning_correct !== null);
const fallbackWarningChecks = caseResults.filter((item) => item.fallback_warning_success !== null);
const distanceChecks = caseResults.filter((item) => item.evidence_distance_ordered !== null);
const recommendationStability = evaluateRecommendationStability(loadRows(), benchmarkCases);
const expertRuleAgreement = evaluateExpertRuleAgreement(caseResults);
const benchmark = {
  benchmark: "pcm_mcp_agent_workflow",
  version: manifest.benchmark.version,
  release: manifest.release,
  transport: "MCP stdio client",
  dataset_sha256: manifest.dataset.sha256,
  case_count: benchmarkCases.length,
  tool_discovery_success: `${discovery.tools.result.tools.length}/${manifest.mcp.tools}`,
  resource_discovery_success: `${discovery.resources.result.resources.length}/${manifest.mcp.resources}`,
  prompt_discovery_success: `${discovery.prompts.result.prompts.length}/${manifest.mcp.prompts}`,
  registry_matches_release: discovery.tools.result.tools.length === manifest.mcp.tools &&
    discovery.resources.result.resources.length === manifest.mcp.resources &&
    discovery.prompts.result.prompts.length === manifest.mcp.prompts,
  context_supported_completion: ratioText(count("building_envelope_context_supported", (item) => item.task_completion)),
  scenario_extension_completion: ratioText(count("scenario_extension", (item) => item.task_completion)),
  battery_stress_completion: ratioText(count("battery_high_cycle_stress", (item) => item.task_completion)),
  low_soc_stress_completion: ratioText(count("low_soc_stress", (item) => item.task_completion)),
  malformed_input_rejection: ratioText(count("malformed_input", (item) => item.invalid_rejection === true)),
  fallback_correctness: ratioText(count("out_of_domain_fallback", (item) => item.fallback_correct === true)),
  risk_warning_correctness: `${riskWarningChecks.filter((item) => item.risk_warning_correct).length}/${riskWarningChecks.length}`,
  low_soc_warning_correctness: `${lowSocWarningChecks.filter((item) => item.low_soc_warning_correct).length}/${lowSocWarningChecks.length}`,
  fallback_warning_success: `${fallbackWarningChecks.filter((item) => item.fallback_warning_success).length}/${fallbackWarningChecks.length}`,
  evidence_trace_completeness: `${evidenceChecks.filter((item) => item.evidence_complete).length}/${evidenceChecks.length}`,
  evidence_distance_ordering: `${distanceChecks.filter((item) => item.evidence_distance_ordered).length}/${distanceChecks.length}`,
  recommendation_top1_stability_under_weight_perturbation: recommendationStability.top1Stable,
  recommendation_top3_stability_under_weight_perturbation: recommendationStability.top3Stable,
  expert_rule_expected_output_agreement: expertRuleAgreement,
  report_reproducibility: `${reportChecks.filter((item) => item.report_reproducible).length}/${reportChecks.length}`,
  average_workflow_latency_ms: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)),
  max_workflow_latency_ms: Math.max(...latencies),
  cases: caseResults,
};

const resultsDir = path.resolve(ROOT, "benchmarks", "results");
fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(path.join(resultsDir, "mcp-agent-benchmark-latest.json"), `${JSON.stringify(benchmark, null, 2)}\n`);
console.log(JSON.stringify(benchmark, null, 2));
await client.close();
