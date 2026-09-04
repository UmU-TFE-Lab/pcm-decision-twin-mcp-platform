#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  compareGroups,
  describeInputs,
  diagnoseAndRecommend,
  evaluateCandidates,
  explainPredictionTool,
  filterRecords,
  generateDecisionPackageTool,
  generateReport,
  getDefaultScenario,
  getDatasetSchemaResource,
  getMcpBenchmark,
  getOperatingWindows,
  getSummary,
  optimizePcmDesignTool,
  predictTwinState,
  recommendDesign,
  runSensitivityAnalysisTool,
  runWhatIf,
  validateScenarioTool,
} from "./tools.mjs";

const scenarioSchema = z.object({
  pcm_type: z.string().optional(),
  system_type: z.string().optional(),
  encapsulation_type: z.string().optional(),
  air_temperature_c: z.number().optional(),
  relative_humidity_pct: z.number().optional(),
  wind_speed_mps: z.number().optional(),
  cloud_cover_pct: z.number().optional(),
  solar_irradiance_wm2: z.number().optional(),
  inlet_fluid_temp_c: z.number().optional(),
  melting_point_c: z.number().optional(),
  latent_heat_kjkg: z.number().optional(),
  thermal_conductivity_wmk: z.number().optional(),
  density_kgm3: z.number().optional(),
  specific_heat_jkgk: z.number().optional(),
  pcm_mass_kg: z.number().optional(),
  surface_area_m2: z.number().optional(),
  pcm_thickness_mm: z.number().optional(),
  mass_flow_rate_kgs: z.number().optional(),
  cycle_number: z.number().optional(),
});

const filterSchema = {
  pcm_type: z.string().optional(),
  system_type: z.string().optional(),
  encapsulation_type: z.string().optional(),
  solar_min: z.number().optional(),
  solar_max: z.number().optional(),
  cycle_min: z.number().optional(),
  cycle_max: z.number().optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

const objectiveSchema = z.enum(["balance", "stored_energy", "efficiency", "loss", "health"]);
const constraintsSchema = z.object({
  min_data_support: z.number().min(0).max(100).optional(),
  max_energy_loss_pct: z.number().min(0).max(100).optional(),
  min_soc_pct: z.number().min(0).max(100).optional(),
  only_direct_evidence: z.boolean().optional(),
  allow_extensions: z.boolean().optional(),
}).optional();
const sensitivityVariableSchema = z.enum([
  "air_temperature_c",
  "solar_irradiance_wm2",
  "inlet_fluid_temp_c",
  "melting_point_c",
  "latent_heat_kjkg",
  "thermal_conductivity_wmk",
  "pcm_mass_kg",
  "pcm_thickness_mm",
  "mass_flow_rate_kgs",
  "cycle_number",
]);

const server = new McpServer({
  name: "pcm-digital-twin-mcp",
  version: "0.2.0",
});

function jsonResult(structuredContent) {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

server.registerTool(
  "get_summary",
  {
    title: "Get PCM dataset summary",
    description: "Return summary statistics for the PCM thermal storage dataset.",
    inputSchema: {},
  },
  async () => jsonResult(getSummary()),
);

server.registerTool(
  "describe_inputs",
  {
    title: "Describe scenario inputs",
    description: "Return model input names, ranges, and a default scenario.",
    inputSchema: {},
  },
  async () => jsonResult(describeInputs()),
);

server.registerTool(
  "get_default_scenario",
  {
    title: "Get default scenario",
    description: "Return the default PCM digital twin scenario based on dataset medians.",
    inputSchema: {},
  },
  async () => jsonResult(getDefaultScenario()),
);

server.registerTool(
  "predict_twin_state",
  {
    title: "Predict twin state",
    description: "Estimate PCM phase fraction, SOC, stored energy, energy loss, efficiency, health, diagnostics, advice, and nearest evidence records.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      limit: z.number().int().min(20).max(1000).optional(),
      evidence_limit: z.number().int().min(1).max(20).optional(),
    },
  },
  async (input) => jsonResult(predictTwinState(input)),
);

server.registerTool(
  "validate_scenario",
  {
    title: "Validate PCM scenario",
    description: "Check category support, numeric ranges, evidence level, extrapolation risk, scenario support, and fallback status before prediction.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
    },
  },
  async (input) => jsonResult(validateScenarioTool(input)),
);

server.registerTool(
  "explain_prediction",
  {
    title: "Explain prediction evidence",
    description: "Return prediction, validation, nearby evidence records, inverse-distance weights, input gaps, saturation audit, diagnostics, and operator-facing recommendations.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      limit: z.number().int().min(20).max(1000).optional(),
      evidence_limit: z.number().int().min(1).max(20).optional(),
      use_fallback: z.boolean().optional(),
    },
  },
  async (input) => jsonResult(explainPredictionTool(input)),
);

server.registerTool(
  "run_sensitivity_analysis",
  {
    title: "Run sensitivity analysis",
    description: "Sweep one scenario variable and report impact on stored energy, efficiency, SOC, loss, health, data support, and risk zones.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      variable: sensitivityVariableSchema.optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      steps: z.number().int().min(3).max(25).optional(),
      objective: objectiveSchema.optional(),
    },
  },
  async (input) => jsonResult(runSensitivityAnalysisTool(input)),
);

server.registerTool(
  "optimize_pcm_design",
  {
    title: "Optimize PCM design",
    description: "Rank PCM type, system type, and encapsulation candidates by balance, energy, efficiency, loss, or health objective.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      objective: objectiveSchema.optional(),
      allow_system_change: z.boolean().optional(),
      limit: z.number().int().min(1).max(24).optional(),
    },
  },
  async (input) => jsonResult(optimizePcmDesignTool(input)),
);

server.registerTool(
  "generate_decision_package",
  {
    title: "Generate decision package",
    description: "Run a complete auditable agent workflow: validation, evidence explanation, sensitivity scan, optimization, diagnostics, report, and machine-readable output.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      objective: objectiveSchema.optional(),
      sensitivity_variable: sensitivityVariableSchema.optional(),
      sensitivity_steps: z.number().int().min(3).max(25).optional(),
      evidence_limit: z.number().int().min(1).max(20).optional(),
      use_fallback: z.boolean().optional(),
      full_analysis: z.boolean().optional(),
      constraints: constraintsSchema,
      task_text: z.string().max(4000).optional(),
    },
  },
  async (input) => jsonResult(generateDecisionPackageTool(input)),
);

server.registerTool(
  "get_mcp_benchmark",
  {
    title: "Get MCP workflow benchmark",
    description: "Return local smoke-test metrics for tool discovery, resource retrieval, malformed input rejection, diagnosis completion, report generation, and evidence trace completeness.",
    inputSchema: {},
  },
  async () => jsonResult(getMcpBenchmark()),
);

server.registerTool(
  "filter_records",
  {
    title: "Filter PCM records",
    description: "Filter dataset rows by PCM type, system type, encapsulation, solar irradiance, and cycle range; returns quality metrics and a sample.",
    inputSchema: filterSchema,
  },
  async (input) => jsonResult(filterRecords(input)),
);

server.registerTool(
  "compare_groups",
  {
    title: "Compare grouped performance",
    description: "Group filtered PCM records and rank performance by efficiency, stored energy, SOC, phase fraction, and loss.",
    inputSchema: {
      ...filterSchema,
      group_by: z.array(z.enum(["pcm_type", "system_type", "encapsulation_type"])).optional(),
    },
  },
  async (input) => jsonResult(compareGroups(input)),
);

server.registerTool(
  "run_what_if",
  {
    title: "Run what-if comparison",
    description: "Compare a baseline PCM scenario with a candidate scenario or candidate overrides.",
    inputSchema: {
      base_scenario: scenarioSchema.optional(),
      candidate_scenario: scenarioSchema.optional(),
      candidate_overrides: scenarioSchema.optional(),
    },
  },
  async (input) => jsonResult(runWhatIf(input)),
);

server.registerTool(
  "evaluate_candidates",
  {
    title: "Evaluate candidate designs",
    description: "Batch-evaluate candidate PCM scenarios against a baseline and rank by a composite score.",
    inputSchema: {
      base_scenario: scenarioSchema.optional(),
      candidates: z.array(scenarioSchema.extend({ name: z.string().optional() })).optional(),
    },
  },
  async (input) => jsonResult(evaluateCandidates(input)),
);

server.registerTool(
  "recommend_design",
  {
    title: "Recommend PCM design",
    description: "Rank PCM and encapsulation combinations for a system and operating context.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      system_type: z.string().optional(),
      air_temperature_c: z.number().optional(),
      solar_irradiance_wm2: z.number().optional(),
      inlet_fluid_temp_c: z.number().optional(),
    },
  },
  async (input) => jsonResult(recommendDesign(input)),
);

server.registerTool(
  "get_operating_windows",
  {
    title: "Get operating windows",
    description: "Return the 24-hour operating profile and best charge/discharge windows for a scenario.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
    },
  },
  async (input) => jsonResult(getOperatingWindows(input)),
);

server.registerTool(
  "diagnose_and_recommend",
  {
    title: "Diagnose and recommend",
    description: "Composite MCP task: predict state, compute health, diagnose risks, recommend designs, choose operating windows, and return fit matrix.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
      limit: z.number().int().min(20).max(1000).optional(),
      evidence_limit: z.number().int().min(1).max(20).optional(),
    },
  },
  async (input) => jsonResult(diagnoseAndRecommend(input)),
);

server.registerTool(
  "generate_report",
  {
    title: "Generate PCM diagnostic report",
    description: "Generate a structured JSON report for the active PCM twin scenario.",
    inputSchema: {
      scenario: scenarioSchema.optional(),
    },
  },
  async (input) => jsonResult(generateReport(input)),
);

server.registerResource(
  "pcm-summary",
  "pcm://dataset/summary",
  {
    title: "PCM Dataset Summary",
    description: "Summary statistics for the active PCM dataset.",
    mimeType: "application/json",
  },
  async () => ({
    contents: [
      {
        uri: "pcm://dataset/summary",
        mimeType: "application/json",
        text: JSON.stringify(getSummary(), null, 2),
      },
    ],
  }),
);

server.registerResource(
  "pcm-schema",
  "pcm://dataset/schema",
  {
    title: "PCM Dataset Schema",
    description: "Scenario categories, input names, ranges, and default scenario.",
    mimeType: "application/json",
  },
  async () => ({
    contents: [
      {
        uri: "pcm://dataset/schema",
        mimeType: "application/json",
        text: JSON.stringify(getDatasetSchemaResource(), null, 2),
      },
    ],
  }),
);

server.registerResource(
  "pcm-agent-guide",
  "pcm://guide/agent-workflows",
  {
    title: "PCM Agent Workflow Guide",
    description: "Suggested MCP tool chains for digital twin analysis tasks.",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [
      {
        uri: "pcm://guide/agent-workflows",
        mimeType: "text/markdown",
        text: [
          "# PCM MCP Agent Workflows",
          "",
          "1. Use `get_summary` or read `pcm://dataset/summary` to understand the dataset.",
          "2. Use `describe_inputs` or read `pcm://dataset/schema` before constructing scenarios.",
          "3. Use `validate_scenario` before prediction to detect extrapolation and evidence limits.",
          "4. Use `explain_prediction` when the user needs nearest records, weights, and saturation audit.",
          "5. Use `run_sensitivity_analysis` for operating-window and what-if sweeps.",
          "6. Use `optimize_pcm_design` for objective-driven material and encapsulation ranking.",
          "7. Use `generate_decision_package` for a complete auditable workflow.",
          "8. Use `get_mcp_benchmark` to report tool/resource/prompt and workflow success metrics.",
        ].join("\n"),
      },
    ],
  }),
);

server.registerResource(
  "pcm-mcp-benchmark",
  "pcm://mcp/benchmark",
  {
    title: "PCM MCP Workflow Benchmark",
    description: "Local evaluation metrics for MCP agent workflow execution.",
    mimeType: "application/json",
  },
  async () => ({
    contents: [
      {
        uri: "pcm://mcp/benchmark",
        mimeType: "application/json",
        text: JSON.stringify(getMcpBenchmark(), null, 2),
      },
    ],
  }),
);

server.registerPrompt(
  "pcm_design_review",
  {
    title: "PCM Design Review",
    description: "Prompt template for reviewing a PCM design context with MCP tools.",
    argsSchema: {
      system_type: z.string().describe("Target system type such as BuildingEnvelope or BatteryCooling"),
      air_temperature_c: z.string().optional().describe("Approximate air temperature in Celsius"),
    },
  },
  async ({ system_type, air_temperature_c }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use the PCM MCP tools to review design options for ${system_type}. Start with validate_scenario, then explain_prediction, run_sensitivity_analysis, and optimize_pcm_design. Explain efficiency, storage, health, evidence support, and loss trade-offs.${air_temperature_c ? ` Use air temperature around ${air_temperature_c} C.` : ""}`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "pcm_diagnostic_report",
  {
    title: "PCM Diagnostic Report",
    description: "Prompt template for producing a diagnosis and report from one scenario.",
    argsSchema: {
      pcm_type: z.string().describe("PCM type"),
      system_type: z.string().describe("System type"),
      encapsulation_type: z.string().describe("Encapsulation type"),
    },
  },
  async ({ pcm_type, system_type, encapsulation_type }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Call generate_decision_package for pcm_type=${pcm_type}, system_type=${system_type}, encapsulation_type=${encapsulation_type}. Summarize scenario support, evidence trace, health drivers, sensitivity result, operator-facing recommendations, and top alternatives.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "pcm_agent_workflow_benchmark",
  {
    title: "PCM Agent Workflow Benchmark",
    description: "Prompt template for evaluating the MCP agent workflow.",
    argsSchema: {
      scenario_name: z.string().optional().describe("Optional label for the target scenario"),
    },
  },
  async ({ scenario_name }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Evaluate the PCM MCP workflow${scenario_name ? ` for ${scenario_name}` : ""}. Call get_mcp_benchmark, then validate_scenario and generate_decision_package. Report tool success, resource success, malformed input handling, evidence trace completeness, and final decision quality.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("PCM Digital Twin MCP server running on stdio");
