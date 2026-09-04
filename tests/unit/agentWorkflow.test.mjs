import assert from "node:assert/strict";
import test from "node:test";
import {
  generateDecisionPackage,
  parseAgentTask,
  validateScenario,
} from "../../src/agentWorkflow.js";
import { loadTestRows, TEST_SCENARIO } from "../helpers/loadRows.mjs";

test("task parser extracts objective, sweep variable, steps and fallback", () => {
  const intent = parseAgentTask(
    "Maximize stored energy, scan solar irradiance with 9 points, and use fallback if needed.",
  );
  assert.equal(intent.objective, "stored_energy");
  assert.equal(intent.sensitivity_variable, "solar_irradiance_wm2");
  assert.equal(intent.sensitivity_steps, 9);
  assert.equal(intent.use_fallback, true);
});

test("unsupported categories are identified and mapped to an explicit fallback", () => {
  const validation = validateScenario(loadTestRows(), {
    ...TEST_SCENARIO,
    system_type: "UnsupportedSystem",
  });
  assert.equal(validation.is_valid, false);
  assert.ok(validation.fallback_scenario);
  assert.notEqual(validation.fallback_scenario.system_type, "UnsupportedSystem");
  assert.ok(validation.warnings.some((warning) => /unsupported/i.test(warning)));
});

test("full decision package is auditable and versioned", () => {
  const result = generateDecisionPackage(loadTestRows(), TEST_SCENARIO, {
    task_text: "Review the scenario, scan solar irradiance, and maximize efficiency.",
    objective: "efficiency",
    sensitivity_variable: "solar_irradiance_wm2",
    sensitivity_steps: 5,
    evidence_limit: 6,
    full_analysis: true,
  });

  assert.equal(result.workflow_status, "completed");
  assert.equal(result.version.dataset_version, "pcm-thermal-storage-v1.0.0");
  assert.match(result.version.task_hash, /^[a-f0-9]+$/);
  assert.equal(result.prediction_explanation.evidence_audit.nearest_records.length, 6);
  assert.ok(result.risk_map.length >= 6);
  assert.ok(result.multi_variable_sensitivity.ranking.length >= 5);
  assert.ok(result.counterfactual_recommendations.length > 0);
  assert.ok(result.tool_chain.every((step) => step.status === "success"));
});
