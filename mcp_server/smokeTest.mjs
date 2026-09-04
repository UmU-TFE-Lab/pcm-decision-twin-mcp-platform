import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["mcp_server/server.mjs"],
  cwd: process.cwd(),
  stderr: "pipe",
});

const client = new Client({ name: "pcm-mcp-smoke-test", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
const resources = await client.listResources();
const prompts = await client.listPrompts();
const summary = await client.callTool({ name: "get_summary", arguments: {} });
const prediction = await client.callTool({
  name: "predict_twin_state",
  arguments: {
    scenario: {
      system_type: "BuildingEnvelope",
      pcm_type: "Organic_Paraffin",
      encapsulation_type: "ShapeStabilized",
    },
    evidence_limit: 2,
  },
});
const diagnosis = await client.callTool({
  name: "diagnose_and_recommend",
  arguments: {
    scenario: {
      system_type: "BuildingEnvelope",
      pcm_type: "Organic_Paraffin",
      encapsulation_type: "ShapeStabilized",
    },
  },
});
const validation = await client.callTool({
  name: "validate_scenario",
  arguments: {
    scenario: {
      system_type: "UnknownSystem",
      solar_irradiance_wm2: 1400,
    },
  },
});
const explanation = await client.callTool({
  name: "explain_prediction",
  arguments: {
    scenario: {
      system_type: "BuildingEnvelope",
      pcm_type: "Organic_Paraffin",
      encapsulation_type: "ShapeStabilized",
    },
    evidence_limit: 3,
  },
});
const sensitivity = await client.callTool({
  name: "run_sensitivity_analysis",
  arguments: {
    variable: "air_temperature_c",
    steps: 5,
  },
});
const optimization = await client.callTool({
  name: "optimize_pcm_design",
  arguments: {
    objective: "balance",
    limit: 4,
  },
});
const decisionPackage = await client.callTool({
  name: "generate_decision_package",
  arguments: {
    sensitivity_steps: 5,
    evidence_limit: 3,
  },
});
const benchmark = await client.callTool({ name: "get_mcp_benchmark", arguments: {} });
const schemaResource = await client.readResource({ uri: "pcm://dataset/schema" });
const benchmarkResource = await client.readResource({ uri: "pcm://mcp/benchmark" });
const prompt = await client.getPrompt({
  name: "pcm_diagnostic_report",
  arguments: {
    pcm_type: "Organic_Paraffin",
    system_type: "BuildingEnvelope",
    encapsulation_type: "ShapeStabilized",
  },
});

console.log(JSON.stringify({
  tool_count: tools.tools.length,
  tools: tools.tools.map((tool) => tool.name),
  resources: resources.resources.map((resource) => resource.uri),
  prompts: prompts.prompts.map((item) => item.name),
  summary: JSON.parse(summary.content[0].text),
  prediction_preview: JSON.parse(prediction.content[0].text).prediction,
  diagnosis_keys: Object.keys(JSON.parse(diagnosis.content[0].text)),
  validation_preview: {
    is_valid: JSON.parse(validation.content[0].text).is_valid,
    scenario_support_score: JSON.parse(validation.content[0].text).scenario_support_score,
  },
  explanation_keys: Object.keys(JSON.parse(explanation.content[0].text)),
  sensitivity_points: JSON.parse(sensitivity.content[0].text).sweep.length,
  optimization_top: JSON.parse(optimization.content[0].text).top_candidates[0]?.combination,
  decision_package_status: JSON.parse(decisionPackage.content[0].text).workflow_status,
  benchmark_preview: JSON.parse(benchmark.content[0].text),
  schema_resource_preview: schemaResource.contents[0].text.slice(0, 180),
  benchmark_resource_preview: benchmarkResource.contents[0].text.slice(0, 180),
  prompt_preview: prompt.messages[0].content.text,
}, null, 2));

await client.close();
