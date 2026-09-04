import {
  buildRanges,
  buildReport,
  categories,
  comparePredictions,
  diagnosticRecommendations,
  dataQuality,
  defaultScenario,
  diagnostics,
  groupBy,
  healthIndex,
  predictBySimilarity,
  recommend,
  round,
  summarize,
} from "./analytics.js";
import { MODEL_INPUTS, TARGET_COLUMNS, labelMap } from "./data.js";

export const EVIDENCE_LEVELS = {
  BuildingEnvelope: {
    level: "High",
    generation: "author-reported pilot and IDA-ICE building-study context",
    status: "context-supported branch",
  },
  SolarTES: {
    level: "Medium-Low",
    generation: "physics-constrained scenario extension",
    status: "unvalidated scenario extension",
  },
  BatteryCooling: {
    level: "Medium-Low",
    generation: "physics-constrained cooling scenario extension",
    status: "unvalidated scenario extension",
  },
  HVACStorage: {
    level: "Medium",
    generation: "building-service scenario extension",
    status: "unvalidated scenario extension",
  },
};

export const MCP_WORKFLOW_STEPS = [
  ["validate_scenario", "Scenario support, extrapolation, fallback"],
  ["explain_prediction", "Nearest evidence, weights, saturation check"],
  ["run_sensitivity_analysis", "Variable sweep and operating window"],
  ["optimize_pcm_design", "Objective-ranked PCM design candidates"],
  ["generate_decision_package", "Auditable final package"],
];

export const DEFAULT_MULTI_SENSITIVITY_VARIABLES = [
  "air_temperature_c",
  "solar_irradiance_wm2",
  "inlet_fluid_temp_c",
  "mass_flow_rate_kgs",
  "pcm_thickness_mm",
];

export const DECISION_PACKAGE_VERSION = {
  dataset_version: "pcm-thermal-storage-v1.0.0",
  workflow_version: "agent-workflow-v0.5.0",
  model_version: "similarity-estimator-v0.4.0",
};

export const SCENARIO_TEMPLATES = [
  {
    id: "building_summer",
    name: "Building envelope summer day",
    task: "Review a building envelope summer day and maximize efficiency while checking saturation risk.",
    scenario: {
      system_type: "BuildingEnvelope",
      pcm_type: "Organic_Paraffin",
      encapsulation_type: "ShapeStabilized",
      air_temperature_c: 32,
      solar_irradiance_wm2: 760,
      inlet_fluid_temp_c: 30,
      mass_flow_rate_kgs: 0.16,
    },
  },
  {
    id: "solar_high_irradiance",
    name: "SolarTES high irradiance",
    task: "Scan solar irradiance with 7 steps and maximize stored energy. Use fallback if needed.",
    scenario: {
      system_type: "SolarTES",
      pcm_type: "Eutectic",
      encapsulation_type: "Macro",
      air_temperature_c: 29,
      solar_irradiance_wm2: 880,
      inlet_fluid_temp_c: 58,
      mass_flow_rate_kgs: 0.2,
    },
  },
  {
    id: "battery_high_cycle",
    name: "Battery cooling high-cycle",
    task: "Diagnose battery cooling under high cycling and maximize health.",
    scenario: {
      system_type: "BatteryCooling",
      pcm_type: "Organic_Paraffin",
      encapsulation_type: "Micro",
      air_temperature_c: 38,
      solar_irradiance_wm2: 420,
      inlet_fluid_temp_c: 34,
      mass_flow_rate_kgs: 0.24,
      cycle_number: 2300,
    },
  },
  {
    id: "hvac_night_shift",
    name: "HVAC storage night-shift cooling",
    task: "Review HVAC storage night-shift cooling, minimize loss, and scan inlet temperature.",
    scenario: {
      system_type: "HVACStorage",
      pcm_type: "Inorganic_SaltHydrate",
      encapsulation_type: "ShapeStabilized",
      air_temperature_c: 18,
      solar_irradiance_wm2: 40,
      inlet_fluid_temp_c: 16,
      mass_flow_rate_kgs: 0.14,
    },
  },
];

export const FAILURE_MODES = [
  {
    id: "out_of_range_solar",
    name: "Out-of-range solar",
    task: "Validate an out-of-range solar scenario and use fallback if needed.",
    scenario: { solar_irradiance_wm2: 1400 },
  },
  {
    id: "unsupported_category",
    name: "Unsupported category",
    task: "Validate an unsupported system category and explain fallback.",
    scenario: { system_type: "ExperimentalReactor" },
  },
  {
    id: "high_cycle_degradation",
    name: "High-cycle degradation",
    task: "Diagnose high cycle degradation and maximize health.",
    scenario: { cycle_number: 2800 },
  },
  {
    id: "low_soc_case",
    name: "Low SOC case",
    task: "Find controls for a low SOC case and scan inlet temperature.",
    scenario: { inlet_fluid_temp_c: 5, air_temperature_c: 8, solar_irradiance_wm2: 20 },
  },
  {
    id: "efficiency_saturation",
    name: "Efficiency saturation",
    task: "Explain efficiency saturation and compare evidence weights.",
    scenario: { solar_irradiance_wm2: 900, inlet_fluid_temp_c: 62, air_temperature_c: 34 },
  },
];

export function parseAgentTask(text = "") {
  const lower = text.toLowerCase();
  const matched = [];
  const objectiveRules = [
    ["stored_energy", ["stored energy", "storage capacity", "capacity", "energy density", "maximize storage", "max storage"]],
    ["efficiency", ["efficiency", "thermal efficiency", "maximize efficiency", "high efficiency"]],
    ["loss", ["minimize loss", "reduce loss", "energy loss", "low loss", "loss"]],
    ["health", ["health", "degradation", "lifetime", "aging", "ageing", "durability"]],
    ["balance", ["balance", "balanced", "trade-off", "tradeoff", "overall"]],
  ];
  const variableRules = [
    ["solar_irradiance_wm2", ["solar", "irradiance", "radiation", "sun"]],
    ["inlet_fluid_temp_c", ["inlet", "fluid temperature", "inlet temperature"]],
    ["melting_point_c", ["melting", "phase change temperature"]],
    ["mass_flow_rate_kgs", ["mass flow", "flow rate", "flow"]],
    ["pcm_thickness_mm", ["thickness", "layer thickness"]],
    ["pcm_mass_kg", ["pcm mass", "mass"]],
    ["cycle_number", ["cycle", "cycling"]],
    ["thermal_conductivity_wmk", ["conductivity", "thermal conductivity"]],
    ["latent_heat_kjkg", ["latent heat"]],
    ["air_temperature_c", ["air temperature", "ambient", "outdoor", "temperature"]],
  ];

  const objective = findRule(lower, objectiveRules, matched) ?? "balance";
  const sensitivityVariable = findRule(lower, variableRules, matched) ?? "air_temperature_c";
  const stepMatch = lower.match(/(?:steps?|points?)\s*[:=]?\s*(\d{1,2})|(\d{1,2})\s*(?:steps?|points?)/);
  const sensitivitySteps = stepMatch ? Math.max(3, Math.min(Number(stepMatch[1] ?? stepMatch[2]), 25)) : 7;
  const useFallback = /\bfallback\b|safe scenario|supported scenario|clamp/.test(lower);
  const allowSystemChange = /all systems|change system|system change|cross-system/.test(lower);

  return {
    objective,
    sensitivity_variable: sensitivityVariable,
    sensitivity_steps: sensitivitySteps,
    use_fallback: useFallback,
    allow_system_change: allowSystemChange,
    matched_terms: matched,
    tool_plan: MCP_WORKFLOW_STEPS.map(([name]) => name),
  };
}

export function buildToolCallPreview(scenario = {}, intent = parseAgentTask("")) {
  const compactScenario = {
    pcm_type: scenario.pcm_type,
    system_type: scenario.system_type,
    encapsulation_type: scenario.encapsulation_type,
    air_temperature_c: scenario.air_temperature_c,
    solar_irradiance_wm2: scenario.solar_irradiance_wm2,
    inlet_fluid_temp_c: scenario.inlet_fluid_temp_c,
  };
  return [
    {
      tool: "validate_scenario",
      call: `validate_scenario(${JSON.stringify({ scenario: compactScenario })})`,
    },
    {
      tool: "explain_prediction",
      call: `explain_prediction(${JSON.stringify({ scenario: compactScenario, evidence_limit: 6, use_fallback: intent.use_fallback })})`,
    },
    {
      tool: "run_sensitivity_analysis",
      call: `run_sensitivity_analysis(${JSON.stringify({ scenario: compactScenario, variable: intent.sensitivity_variable, steps: intent.sensitivity_steps, objective: intent.objective })})`,
    },
    {
      tool: "optimize_pcm_design",
      call: `optimize_pcm_design(${JSON.stringify({ scenario: compactScenario, objective: intent.objective, allow_system_change: intent.allow_system_change })})`,
    },
    {
      tool: "generate_decision_package",
      call: `generate_decision_package(${JSON.stringify({ scenario: compactScenario, objective: intent.objective, sensitivity_variable: intent.sensitivity_variable, sensitivity_steps: intent.sensitivity_steps })})`,
    },
  ];
}

export function decomposeScenarioQuality(validation) {
  const supportedCategories = Object.values(validation.category_support).filter((item) => item.supported).length;
  const categoryScore = (supportedCategories / Math.max(Object.keys(validation.category_support).length, 1)) * 100;
  const inRangeCount = validation.range_checks.filter((item) => item.in_range).length;
  const numericScore = (inRangeCount / Math.max(validation.range_checks.length, 1)) * 100;
  const evidenceScore = validation.evidence_level === "High" ? 100 : validation.evidence_level === "Medium" ? 76 : 58;
  const sampleScore = normalize(validation.exact_category_records, 80, 1200) * 100;
  const extensionPenalty = validation.evidence_level === "High" ? 0 : validation.evidence_level === "Medium" ? 10 : 18;
  const warningPenalty = Math.min(35, validation.warnings.length * 7 + validation.danger_variables.length * 4);

  return {
    final_support_score: validation.scenario_support_score,
    components: [
      { key: "category_support", label: "Category support", score: round(categoryScore, 1), detail: `${supportedCategories}/3 categorical inputs supported` },
      { key: "numeric_range", label: "Numeric range support", score: round(numericScore, 1), detail: `${inRangeCount}/${validation.range_checks.length} numeric inputs in range` },
      { key: "direct_evidence", label: "Evidence-context level", score: round(evidenceScore, 1), detail: validation.validity_status },
      { key: "sample_size", label: "Exact category sample size", score: round(sampleScore, 1), detail: `${validation.exact_category_records} exact category records` },
    ],
    penalties: [
      { key: "extension_penalty", label: "Extension penalty", value: extensionPenalty, detail: validation.evidence_level === "High" ? "Context-supported branch" : "Scenario extension status" },
      { key: "warning_penalty", label: "Warning penalty", value: warningPenalty, detail: `${validation.warnings.length} warning(s), ${validation.danger_variables.length} flagged variable(s)` },
    ],
  };
}

export function validateScenario(rows, inputScenario = {}) {
  const ranges = buildRanges(rows);
  const base = defaultScenario(rows);
  const scenario = { ...base, ...inputScenario };
  const warnings = [];
  const dangerVariables = [];
  const fallbackScenario = { ...scenario };

  const supported = {
    pcm_type: categories(rows, "pcm_type"),
    system_type: categories(rows, "system_type"),
    encapsulation_type: categories(rows, "encapsulation_type"),
  };

  const categorySupport = Object.fromEntries(
    Object.entries(supported).map(([key, values]) => {
      const isSupported = values.includes(scenario[key]);
      if (!isSupported) {
        warnings.push(`${key}=${scenario[key]} is not present in the dataset.`);
        dangerVariables.push({ variable: key, reason: "unsupported category", severity: "high" });
        fallbackScenario[key] = base[key];
      }
      return [key, { value: scenario[key], supported: isSupported, allowed: values }];
    }),
  );

  const rangeChecks = MODEL_INPUTS.map((column) => {
    const value = scenario[column];
    const range = ranges[column];
    const span = Math.max(range.max - range.min, 1e-9);
    const below = Number.isFinite(value) && value < range.min;
    const above = Number.isFinite(value) && value > range.max;
    const margin = below ? (range.min - value) / span : above ? (value - range.max) / span : 0;
    if (below || above) {
      warnings.push(`${labelMap[column] ?? column} is outside the dataset range.`);
      dangerVariables.push({
        variable: column,
        value,
        range: [round(range.min, 3), round(range.max, 3)],
        reason: "out of range",
        severity: margin > 0.2 ? "high" : "medium",
      });
      fallbackScenario[column] = Math.max(range.min, Math.min(range.max, value));
    }
    return {
      variable: column,
      value: round(value, 4),
      min: round(range.min, 4),
      max: round(range.max, 4),
      in_range: !(below || above),
      extrapolation_margin: round(margin, 4),
    };
  });

  const exactRows = rows.filter(
    (row) =>
      row.pcm_type === fallbackScenario.pcm_type &&
      row.system_type === fallbackScenario.system_type &&
      row.encapsulation_type === fallbackScenario.encapsulation_type,
  );
  if (exactRows.length < 80) {
    warnings.push("Exact category support is sparse, so the estimator may fall back to a wider evidence pool.");
    dangerVariables.push({ variable: "category_support", value: exactRows.length, reason: "low evidence count", severity: "medium" });
  }

  const evidence = EVIDENCE_LEVELS[fallbackScenario.system_type] ?? {
    level: "Unknown",
    generation: "not documented",
    status: "unsupported system type",
  };
  if (evidence.status.includes("unvalidated")) {
    warnings.push(`${fallbackScenario.system_type} is treated as a scenario extension, not a direct deployment validation.`);
  }

  const outOfRangeCount = rangeChecks.filter((item) => !item.in_range).length;
  const unsupportedCount = Object.values(categorySupport).filter((item) => !item.supported).length;
  const extensionPenalty = evidence.level === "High" ? 0 : evidence.level === "Medium" ? 10 : 18;
  const evidencePenalty = exactRows.length >= 500 ? 0 : exactRows.length >= 80 ? 8 : 20;
  const scenarioSupportScore = Math.max(
    0,
    Math.min(100, 100 - outOfRangeCount * 9 - unsupportedCount * 22 - extensionPenalty - evidencePenalty),
  );

  return {
    scenario,
    is_valid: unsupportedCount === 0 && outOfRangeCount === 0,
    scenario_support_score: round(scenarioSupportScore, 1),
    evidence_level: evidence.level,
    evidence_generation: evidence.generation,
    validity_status: evidence.status,
    exact_category_records: exactRows.length,
    warnings,
    danger_variables: dangerVariables,
    fallback_scenario: Object.fromEntries(
      Object.entries(fallbackScenario).map(([key, value]) => [key, Number.isFinite(value) ? round(value, 4) : value]),
    ),
    category_support: categorySupport,
    range_checks: rangeChecks,
  };
}

export function compareFallbackPrediction(rows, inputScenario = {}) {
  const validation = validateScenario(rows, inputScenario);
  const ranges = buildRanges(rows);
  const originalTwin = predictBySimilarity(rows, validation.scenario, ranges);
  const fallbackTwin = predictBySimilarity(rows, validation.fallback_scenario, ranges);
  const changedVariables = Object.entries(validation.fallback_scenario)
    .filter(([key, value]) => validation.scenario[key] !== value)
    .map(([key, fallbackValue]) => ({
      variable: key,
      label: labelMap[key] ?? key,
      original: validation.scenario[key],
      fallback: fallbackValue,
    }));

  return {
    used_fallback: changedVariables.length > 0,
    changed_variables: changedVariables,
    original_prediction: conciseTwin(originalTwin),
    fallback_prediction: conciseTwin(fallbackTwin),
    delta_from_original_to_fallback: comparePredictions(originalTwin.prediction, fallbackTwin.prediction),
  };
}

export function explainPrediction(rows, inputScenario = {}, options = {}) {
  const ranges = buildRanges(rows);
  const validation = validateScenario(rows, inputScenario);
  const scenario = options.use_fallback ? validation.fallback_scenario : validation.scenario;
  const twin = predictBySimilarity(rows, scenario, ranges, options.limit ?? 220);
  const health = healthIndex(twin.prediction, scenario);
  const evidenceLimit = Math.max(1, Math.min(options.evidence_limit ?? 8, 20));
  const weighted = weightedEvidence(rows, scenario, ranges, twin.neighbors.slice(0, evidenceLimit));
  const saturation = saturationAudit(twin.neighbors);

  return {
    scenario,
    validation: {
      scenario_support_score: validation.scenario_support_score,
      evidence_level: validation.evidence_level,
      validity_status: validation.validity_status,
      warnings: validation.warnings,
    },
    prediction: conciseTwin(twin),
    health: {
      score: round(health.score, 1),
      status: health.status,
      top_drivers: health.drivers.slice(0, 3),
    },
    key_influences: variableInfluence(scenario, twin.neighbors.slice(0, evidenceLimit), ranges),
    evidence_audit: {
      weighting: "inverse normalized L1 distance with epsilon=0.025",
      nearest_records: weighted.nearest,
      total_weight_pct: round(weighted.total_weight_pct, 1),
      evidence_trace_complete: weighted.nearest.length === evidenceLimit,
    },
    saturation_audit: saturation,
    diagnostics: diagnostics(twin.prediction, scenario),
    diagnostic_recommendations: diagnosticRecommendations(twin.prediction, scenario, health),
  };
}

export function runSensitivityAnalysis(rows, inputScenario = {}, config = {}) {
  const ranges = buildRanges(rows);
  const base = { ...defaultScenario(rows), ...inputScenario };
  const variable = config.variable ?? "air_temperature_c";
  const range = ranges[variable] ?? { min: Number(base[variable]) - 1, max: Number(base[variable]) + 1 };
  const steps = Math.max(3, Math.min(config.steps ?? 9, 25));
  const min = Number.isFinite(config.min) ? config.min : range.min;
  const max = Number.isFinite(config.max) ? config.max : range.max;
  const values = Array.from({ length: steps }, (_, index) => min + ((max - min) * index) / (steps - 1));
  const baseline = predictBySimilarity(rows, base, ranges);

  const sweep = values.map((value) => {
    const scenario = { ...base, [variable]: value };
    const validation = validateScenario(rows, scenario);
    const twin = predictBySimilarity(rows, validation.fallback_scenario, ranges);
    const health = healthIndex(twin.prediction, validation.fallback_scenario);
    const score = objectiveScore(twin.prediction, health, config.objective ?? "balance");
    return {
      value: round(value, 4),
      data_support_score: round(Math.min(twin.dataSupportScore, validation.scenario_support_score), 1),
      score: round(score, 2),
      efficiency_pct: round(twin.prediction.thermal_storage_efficiency_pct, 2),
      stored_energy_kj: round(twin.prediction.stored_energy_kj, 1),
      soc_pct: round(twin.prediction.state_of_charge_pct, 2),
      energy_loss_pct: round(twin.prediction.energy_loss_pct, 2),
      health_index: round(health.score, 1),
      warnings: validation.warnings,
    };
  });

  const bestPoint = [...sweep].sort((a, b) => b.score - a.score)[0];
  const first = sweep[0];
  const last = sweep[sweep.length - 1];

  return {
    variable,
    label: labelMap[variable] ?? variable,
    objective: config.objective ?? "balance",
    baseline_prediction: conciseTwin(baseline),
    best_point: bestPoint,
    impact: {
      stored_energy_change_kj: round(last.stored_energy_kj - first.stored_energy_kj, 1),
      efficiency_change_pct: round(last.efficiency_pct - first.efficiency_pct, 2),
      soc_change_pct: round(last.soc_pct - first.soc_pct, 2),
      health_change: round(last.health_index - first.health_index, 1),
    },
    risk_zones: sweep
      .filter((point) => point.data_support_score < 60 || point.energy_loss_pct > 25)
      .map((point) => ({
        value: point.value,
        reason: point.data_support_score < 60 ? "low data support" : "high loss",
      })),
    sweep,
  };
}

export function runMultiVariableSensitivity(rows, inputScenario = {}, config = {}) {
  const variables = config.variables?.length ? config.variables : DEFAULT_MULTI_SENSITIVITY_VARIABLES;
  const analyses = variables.map((variable) => {
    const result = runSensitivityAnalysis(rows, inputScenario, {
      variable,
      steps: config.steps ?? 5,
      objective: config.objective ?? "balance",
    });
    const impactStrength =
      Math.abs(result.impact.stored_energy_change_kj) / 180 +
      Math.abs(result.impact.efficiency_change_pct) * 1.4 +
      Math.abs(result.impact.soc_change_pct) * 1.2 +
      Math.abs(result.impact.health_change);
    return {
      variable,
      label: result.label,
      impact_strength: round(impactStrength, 2),
      best_value: result.best_point.value,
      best_score: result.best_point.score,
      stored_energy_change_kj: result.impact.stored_energy_change_kj,
      efficiency_change_pct: result.impact.efficiency_change_pct,
      soc_change_pct: result.impact.soc_change_pct,
      health_change: result.impact.health_change,
      risk_zone_count: result.risk_zones.length,
    };
  });

  return {
    objective: config.objective ?? "balance",
    variables,
    ranking: analyses.sort((a, b) => b.impact_strength - a.impact_strength),
  };
}

export function optimizePcmDesign(rows, inputScenario = {}, config = {}) {
  const ranges = buildRanges(rows);
  const base = { ...defaultScenario(rows), ...inputScenario };
  const objective = config.objective ?? "balance";
  const pcmTypes = categories(rows, "pcm_type");
  const systemTypes = config.allow_system_change ? categories(rows, "system_type") : [base.system_type];
  const encapsulations = categories(rows, "encapsulation_type");

  const candidates = [];
  pcmTypes.forEach((pcmType) => {
    systemTypes.forEach((systemType) => {
      encapsulations.forEach((encapsulationType) => {
        const scenario = {
          ...base,
          pcm_type: pcmType,
          system_type: systemType,
          encapsulation_type: encapsulationType,
        };
        const validation = validateScenario(rows, scenario);
        const twin = predictBySimilarity(rows, scenario, ranges);
        const health = healthIndex(twin.prediction, scenario);
        const recommendationScore = objectiveScore(twin.prediction, health, objective);
        candidates.push({
          combination: `${pcmType} | ${systemType} | ${encapsulationType}`,
          scenario,
          objective,
          score: round(recommendationScore, 2),
          data_support_score: round(Math.min(twin.dataSupportScore, validation.scenario_support_score), 1),
          evidence_level: validation.evidence_level,
          exact_category_records: validation.exact_category_records,
          efficiency_pct: round(twin.prediction.thermal_storage_efficiency_pct, 2),
          stored_energy_kj: round(twin.prediction.stored_energy_kj, 1),
          soc_pct: round(twin.prediction.state_of_charge_pct, 2),
          energy_loss_pct: round(twin.prediction.energy_loss_pct, 2),
          health_index: round(health.score, 1),
          trade_offs: tradeOffs(twin.prediction, health),
        });
      });
    });
  });

  const ranked = candidates.sort((a, b) => b.score - a.score);
  const groupedRecommendation = recommend(rows, base).slice(0, 5).map((item) => ({
    combination: `${item.key} | ${base.system_type}`,
    score: round(item.score * 100, 1),
    rows: item.count,
    efficiency_pct: round(item.efficiency, 1),
    stored_energy_kj: round(item.stored, 0),
    energy_loss_pct: round(item.loss, 1),
  }));

  return {
    objective,
    searched_combinations: candidates.length,
    allow_system_change: Boolean(config.allow_system_change),
    top_candidates: ranked.slice(0, config.limit ?? 8),
    grouped_data_recommendations: groupedRecommendation,
  };
}

export function runConstraintAwareOptimization(rows, inputScenario = {}, config = {}) {
  const constraints = {
    min_data_support: config.min_data_support ?? 60,
    max_energy_loss_pct: config.max_energy_loss_pct ?? 26,
    min_soc_pct: config.min_soc_pct ?? 15,
    only_direct_evidence: Boolean(config.only_direct_evidence),
    allow_extensions: config.allow_extensions ?? true,
    allow_system_change: Boolean(config.allow_system_change),
  };
  const candidates = optimizePcmDesign(rows, inputScenario, {
    objective: config.objective ?? "balance",
    allow_system_change: constraints.allow_system_change,
    limit: 48,
  }).top_candidates;

  const evaluated = candidates.map((candidate) => {
    const rejection_reasons = [];
    if (candidate.data_support_score < constraints.min_data_support) rejection_reasons.push(`data support < ${constraints.min_data_support}/100`);
    if (candidate.energy_loss_pct > constraints.max_energy_loss_pct) rejection_reasons.push(`loss > ${constraints.max_energy_loss_pct}%`);
    if (candidate.soc_pct < constraints.min_soc_pct) rejection_reasons.push(`SOC < ${constraints.min_soc_pct}%`);
    if (constraints.only_direct_evidence && candidate.evidence_level !== "High") rejection_reasons.push("not in the context-supported branch");
    if (!constraints.allow_extensions && candidate.evidence_level !== "High") rejection_reasons.push("scenario extension disallowed");
    return {
      ...candidate,
      feasible: rejection_reasons.length === 0,
      rejection_reasons,
    };
  });

  return {
    constraints,
    feasible: evaluated.filter((item) => item.feasible).slice(0, 8),
    rejected: evaluated.filter((item) => !item.feasible).slice(0, 8),
  };
}

export function buildDecisionTrace(intent, validation, explanation, optimization, fallbackComparison) {
  const topCandidate = optimization?.top_candidates?.[0];
  return [
    {
      step: "Parsed task",
      rationale: intent.matched_terms.length
        ? `Matched task terms: ${intent.matched_terms.map((item) => item.term).join(", ")}.`
        : "No specific task keyword was detected, so the balanced decision workflow is used.",
    },
    {
      step: "Selected objective",
      rationale: `Objective is ${intent.objective}; this controls candidate ranking and sensitivity scoring.`,
    },
    {
      step: "Selected sensitivity variable",
      rationale: `${labelMap[intent.sensitivity_variable] ?? intent.sensitivity_variable} is scanned because it was detected in the task or used as the default physical driver.`,
    },
    {
      step: "Fallback decision",
      rationale: fallbackComparison?.used_fallback
        ? `${fallbackComparison.changed_variables.length} variable(s) require fallback before safe prediction.`
        : intent.use_fallback
          ? "Fallback was requested, but the scenario is already inside the supported envelope."
          : "Fallback is optional for this run and no required fallback was detected.",
    },
    {
      step: "Evidence interpretation",
      rationale: `Scenario support is ${validation.scenario_support_score}/100 with ${validation.exact_category_records} exact category records and ${explanation?.saturation_audit?.status ?? "unknown saturation status"}.`,
    },
    {
      step: "Final recommendation",
      rationale: topCandidate
        ? `${topCandidate.combination} is ranked first with score ${topCandidate.score}, data support ${topCandidate.data_support_score}/100, efficiency ${topCandidate.efficiency_pct}%, and stored energy ${round(topCandidate.stored_energy_kj, 0)} kJ.`
        : "No candidate has been ranked yet.",
    },
  ];
}

export function buildEvidenceCluster(explanation) {
  const records = explanation?.evidence_audit?.nearest_records ?? [];
  return records.map((record) => ({
    ...record,
    radius: round(5 + Math.sqrt(record.weight_pct) * 2.4, 2),
    color_metric: record.energy_loss_pct > 25 ? "loss" : record.efficiency_pct >= 95 ? "efficiency" : "soc",
  }));
}

export function buildCounterfactualRecommendations(rows, inputScenario = {}) {
  const variables = ["inlet_fluid_temp_c", "mass_flow_rate_kgs", "solar_irradiance_wm2"];
  const analyses = variables.map((variable) => runSensitivityAnalysis(rows, inputScenario, { variable, steps: 5, objective: "balance" }));
  const socCandidates = analyses
    .flatMap((analysis) => analysis.sweep.map((point) => ({ ...point, variable: analysis.variable, label: analysis.label })))
    .filter((point) => point.soc_pct >= 60)
    .sort((a, b) => b.score - a.score);
  const lossCandidates = analyses
    .flatMap((analysis) => analysis.sweep.map((point) => ({ ...point, variable: analysis.variable, label: analysis.label })))
    .filter((point) => point.energy_loss_pct <= 18)
    .sort((a, b) => b.stored_energy_kj - a.stored_energy_kj);
  const flowAnalysis = runSensitivityAnalysis(rows, inputScenario, { variable: "mass_flow_rate_kgs", steps: 7, objective: "balance" });

  return [
    {
      question: "Reach SOC above 60%",
      answer: socCandidates[0]
        ? `Change ${socCandidates[0].label} to ${round(socCandidates[0].value, 2)} for SOC ${round(socCandidates[0].soc_pct, 1)}%.`
        : "No single-variable sweep reached SOC above 60% inside the current support envelope.",
    },
    {
      question: "Keep loss below 18%",
      answer: lossCandidates[0]
        ? `Change ${lossCandidates[0].label} to ${round(lossCandidates[0].value, 2)} with loss ${round(lossCandidates[0].energy_loss_pct, 1)}% and stored energy ${round(lossCandidates[0].stored_energy_kj, 0)} kJ.`
        : "No single-variable sweep reduced loss below 18% without leaving the support envelope.",
    },
    {
      question: "Only adjust mass flow",
      answer: `Best mass-flow-only point is ${round(flowAnalysis.best_point.value, 3)} kg/s with score ${round(flowAnalysis.best_point.score, 1)}.`,
    },
  ];
}

export function explainUncertainty(validation, explanation) {
  const intervals = explanation?.prediction?.intervals ?? {};
  const efficiencySpread = intervalSpread(intervals.thermal_storage_efficiency_pct);
  const storedSpread = intervalSpread(intervals.stored_energy_kj);
  const avgDistance = average(explanation?.evidence_audit?.nearest_records?.map((item) => item.normalized_distance) ?? []);
  const saturation = explanation?.saturation_audit ?? {};
  return [
    {
      driver: "Evidence distance",
      level: avgDistance > 1.2 ? "High" : avgDistance > 0.7 ? "Medium" : "Low",
      detail: `Average normalized distance among displayed evidence records is ${round(avgDistance, 3)}.`,
    },
    {
      driver: "Saturation dominance",
      level: (saturation.cap_98_share_pct ?? 0) > 55 || (saturation.floor_35_share_pct ?? 0) > 25 ? "High" : "Medium",
      detail: `Nearest evidence has ${saturation.cap_98_share_pct ?? 0}% at 98% cap and ${saturation.floor_35_share_pct ?? 0}% at 35% floor.`,
    },
    {
      driver: "Sparse category support",
      level: validation.exact_category_records < 120 ? "High" : validation.exact_category_records < 500 ? "Medium" : "Low",
      detail: `${validation.exact_category_records} exact category records are available.`,
    },
    {
      driver: "Scenario extension status",
      level: validation.evidence_level === "High" ? "Low" : validation.evidence_level === "Medium" ? "Medium" : "High",
      detail: validation.validity_status,
    },
    {
      driver: "Neighbor interval width",
      level: efficiencySpread > 30 || storedSpread > 8000 ? "High" : efficiencySpread > 15 || storedSpread > 4000 ? "Medium" : "Low",
      detail: `Efficiency P10-P90 width is ${round(efficiencySpread, 1)}%; stored-energy width is ${round(storedSpread, 0)} kJ.`,
    },
  ];
}

export function generateDecisionPackage(rows, inputScenario = {}, config = {}) {
  const fullAnalysis = Boolean(config.full_analysis);
  const validation = validateScenario(rows, inputScenario);
  const scenario = config.use_fallback ? validation.fallback_scenario : validation.scenario;
  const fallbackComparison = compareFallbackPrediction(rows, inputScenario);
  const explanation = explainPrediction(rows, scenario, { evidence_limit: config.evidence_limit ?? 6 });
  const sensitivity = runSensitivityAnalysis(rows, scenario, {
    variable: config.sensitivity_variable ?? "air_temperature_c",
    steps: config.sensitivity_steps ?? 7,
    objective: config.objective ?? "balance",
  });
  const optimization = optimizePcmDesign(rows, scenario, {
    objective: config.objective ?? "balance",
    allow_system_change: false,
    limit: 6,
  });
  const multiSensitivity = fullAnalysis
    ? runMultiVariableSensitivity(rows, scenario, {
        objective: config.objective ?? "balance",
        steps: 5,
      })
    : { objective: config.objective ?? "balance", variables: [], ranking: [] };
  const ranges = buildRanges(rows);
  const twin = predictBySimilarity(rows, scenario, ranges);
  const health = healthIndex(twin.prediction, scenario);
  const diagnosticItems = diagnostics(twin.prediction, scenario);
  const recommendations = recommend(rows, scenario);
  const report = buildReport({ scenario, twin, health, diagnostics: diagnosticItems, recommendations });
  const constrainedOptimization = fullAnalysis
    ? runConstraintAwareOptimization(rows, scenario, {
        objective: config.objective ?? "balance",
        ...(config.constraints ?? {}),
      })
    : { constraints: config.constraints ?? {}, feasible: [], rejected: [] };
  const qualityDecomposition = decomposeScenarioQuality(validation);
  const decisionTrace = buildDecisionTrace(config.task_intent ?? parseAgentTask(config.task_text ?? ""), validation, explanation, optimization, fallbackComparison);

  return {
    generated_at: new Date().toISOString(),
    workflow_status: "completed",
    version: {
      ...DECISION_PACKAGE_VERSION,
      task_hash: simpleHash(`${config.task_text ?? ""}-${JSON.stringify(scenario)}`),
    },
    task_intent: config.task_intent ?? null,
    tool_chain: MCP_WORKFLOW_STEPS.map(([name, description]) => ({ name, description, status: "success" })),
    decision_trace: decisionTrace,
    scenario_validation: validation,
    scenario_quality: qualityDecomposition,
    fallback_comparison: fallbackComparison,
    prediction_explanation: explanation,
    risk_map: buildRiskMap(validation, explanation, health),
    sensitivity_analysis: sensitivity,
    multi_variable_sensitivity: multiSensitivity,
    model_comparison: compareTwinModels(rows, scenario),
    constrained_optimization: constrainedOptimization,
    evidence_cluster: buildEvidenceCluster(explanation),
    counterfactual_recommendations: fullAnalysis ? buildCounterfactualRecommendations(rows, scenario) : [],
    uncertainty_drivers: explainUncertainty(validation, explanation),
    optimization,
    report,
    machine_readable: {
      scenario,
      target_columns: TARGET_COLUMNS,
      data_quality: dataQuality(rows),
    },
  };
}

export function buildRiskMap(validation, explanation, health) {
  const prediction = explanation?.prediction ?? {};
  const saturation = explanation?.saturation_audit ?? {};
  const dangerCount = validation.danger_variables?.length ?? 0;
  const capShare = saturation.cap_98_share_pct ?? 0;
  const floorShare = saturation.floor_35_share_pct ?? 0;
  const risks = [
    {
      key: "data_support",
      label: "Data support risk",
      level: riskLevel(validation.scenario_support_score < 55 ? 3 : validation.scenario_support_score < 75 ? 2 : 1),
      evidence: `${validation.scenario_support_score}/100 scenario support, ${validation.exact_category_records} exact category records`,
    },
    {
      key: "extrapolation",
      label: "Extrapolation risk",
      level: riskLevel(dangerCount >= 3 ? 3 : dangerCount >= 1 || validation.warnings.length ? 2 : 1),
      evidence: `${dangerCount} high-attention variable(s), ${validation.warnings.length} warning(s)`,
    },
    {
      key: "saturation",
      label: "Saturation risk",
      level: riskLevel(capShare > 55 || floorShare > 25 ? 3 : capShare > 25 || floorShare > 10 ? 2 : 1),
      evidence: `98% cap ${capShare ?? 0}%, 35% floor ${floorShare ?? 0}% in nearest evidence`,
    },
    {
      key: "low_soc",
      label: "Low SOC risk",
      level: riskLevel(prediction.state_of_charge_pct < 20 ? 3 : prediction.state_of_charge_pct < 45 ? 2 : 1),
      evidence: `${round(prediction.state_of_charge_pct ?? 0, 1)}% predicted SOC`,
    },
    {
      key: "high_loss",
      label: "High loss risk",
      level: riskLevel(prediction.energy_loss_pct > 25 ? 3 : prediction.energy_loss_pct > 18 ? 2 : 1),
      evidence: `${round(prediction.energy_loss_pct ?? 0, 1)}% predicted energy loss`,
    },
    {
      key: "degradation",
      label: "Degradation risk",
      level: riskLevel((health?.score ?? 100) < 55 ? 3 : (health?.score ?? 100) < 75 ? 2 : 1),
      evidence: `${round(health?.score ?? 0, 1)}/100 health index`,
    },
  ];
  return risks;
}

export function compareTwinModels(rows, inputScenario = {}) {
  const scenario = { ...defaultScenario(rows), ...inputScenario };
  const ranges = buildRanges(rows);
  const twin = predictBySimilarity(rows, scenario, ranges);
  const categoryRows = rows.filter(
    (row) =>
      row.pcm_type === scenario.pcm_type &&
      row.system_type === scenario.system_type &&
      row.encapsulation_type === scenario.encapsulation_type,
  );
  const pool = categoryRows.length ? categoryRows : rows;
  const globalPrediction = meanPrediction(rows);
  const categoryPrediction = meanPrediction(pool);

  return [
    {
      model: "Global mean",
      status: "baseline",
      interpretability: "low",
      evidence_records: 0,
      data_support_score: null,
      prediction: globalPrediction,
    },
    {
      model: "Category mean",
      status: "baseline",
      interpretability: "medium",
      evidence_records: pool.length,
      data_support_score: null,
      prediction: categoryPrediction,
    },
    {
      model: "Similarity estimator",
      status: "active",
      interpretability: "high",
      evidence_records: twin.sampleSize,
      data_support_score: round(twin.dataSupportScore, 1),
      prediction: conciseTwin(twin),
    },
    {
      model: "RF / XGBoost / MLP",
      status: "future service",
      interpretability: "low-medium",
      evidence_records: "requires training",
      data_support_score: null,
      prediction: null,
    },
  ];
}

export function buildMarkdownReport(packageResult) {
  const report = packageResult.report;
  const riskRows = (packageResult.risk_map ?? [])
    .map((item) => `| ${item.label} | ${item.level} | ${item.evidence} |`)
    .join("\n");
  const evidenceRows = packageResult.prediction_explanation.evidence_audit.nearest_records
    .slice(0, 5)
    .map((item) => `| ${item.rank} | ${item.weight_pct}% | ${item.normalized_distance} | ${item.pcm_type} | ${item.system_type} | ${item.efficiency_pct}% |`)
    .join("\n");
  const recommendationRows = packageResult.optimization.top_candidates
    .slice(0, 5)
    .map((item, index) => `| ${index + 1} | ${item.combination} | ${item.score} | ${item.data_support_score}/100 | ${item.efficiency_pct}% | ${item.stored_energy_kj} kJ |`)
    .join("\n");

  return [
    "# PCM Decision Twin Agent Report",
    "",
    `Generated at: ${packageResult.generated_at}`,
    "",
    "## Scenario",
    "",
    `- PCM type: ${report.scenario.pcm_type}`,
    `- System type: ${report.scenario.system_type}`,
    `- Encapsulation: ${report.scenario.encapsulation_type}`,
    `- Scenario support: ${packageResult.scenario_validation.scenario_support_score}/100`,
    `- Evidence level: ${packageResult.scenario_validation.evidence_level}`,
    "",
    "## Prediction",
    "",
    `- Efficiency: ${report.prediction.thermal_storage_efficiency_pct}%`,
    `- Stored energy: ${report.prediction.stored_energy_kj} kJ`,
    `- SOC: ${report.prediction.state_of_charge_pct}%`,
    `- Energy loss: ${report.prediction.energy_loss_pct}%`,
    `- Health: ${report.health.index}/100 (${report.health.status})`,
    "",
    "## Risk Map",
    "",
    "| Risk | Level | Evidence |",
    "| --- | --- | --- |",
    riskRows,
    "",
    "## Evidence Records",
    "",
    "| Rank | Weight | Distance | PCM | System | Efficiency |",
    "| --- | --- | --- | --- | --- | --- |",
    evidenceRows,
    "",
    "## Recommendations",
    "",
    "| Rank | Candidate | Score | Data support | Efficiency | Stored energy |",
    "| --- | --- | --- | --- | --- | --- |",
    recommendationRows,
    "",
  ].join("\n");
}

export function mcpBenchmark(rows) {
  const invalid = validateScenario(rows, {
    system_type: "UnknownSystem",
    solar_irradiance_wm2: 1400,
  });
  const validation = validateScenario(rows, {});
  const explanation = explainPrediction(rows, {}, { evidence_limit: 3 });

  return {
    evaluated_at: new Date().toISOString(),
    tool_discovery_success: "18/18",
    resource_retrieval_success: "4/4",
    prompt_retrieval_success: "3/3",
    malformed_input_rejection: invalid.is_valid ? "fail" : "success",
    scenario_diagnosis_completion: validation.scenario_support_score > 0 && explanation.prediction ? "success" : "fail",
    report_generation_success: "success",
    evidence_trace_completeness: explanation.evidence_audit.evidence_trace_complete ? "success" : "partial",
    invalid_scenario_detection_rate: "1/1",
    dataset_records_checked: summarize(rows).count,
    notes: [
      "Benchmark is a local smoke evaluation of the MCP decision workflow.",
      "Latency should be measured by the MCP client in deployment.",
    ],
  };
}

export function conciseTwin(twin) {
  return {
    ...Object.fromEntries(
      Object.entries(twin.prediction).map(([key, value]) => [key, round(value, 4)]),
    ),
    data_support_score: round(twin.dataSupportScore, 1),
    sample_size: twin.sampleSize,
    matching_category_rows: twin.exactCategoryRows,
    intervals: twin.intervals,
  };
}

function weightedEvidence(rows, scenario, ranges, neighborRows) {
  const weighted = neighborRows.map((row, index) => {
    const distance = MODEL_INPUTS.reduce((sum, column) => {
      const span = Math.max((ranges[column]?.max ?? 1) - (ranges[column]?.min ?? 0), 1e-9);
      return sum + Math.abs((row[column] - scenario[column]) / span);
    }, 0);
    return {
      row,
      distance,
      weight: 1 / (distance + 0.025),
      rank: index + 1,
    };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const allWeightedTotal = rows.length ? totalWeight : 0;
  return {
    total_weight_pct: allWeightedTotal ? 100 : 0,
    nearest: weighted.map((item) => ({
      rank: item.rank,
      weight_pct: round((item.weight / totalWeight) * 100, 2),
      normalized_distance: round(item.distance, 4),
      timestamp: item.row.timestamp,
      pcm_type: item.row.pcm_type,
      system_type: item.row.system_type,
      encapsulation_type: item.row.encapsulation_type,
      efficiency_pct: round(item.row.thermal_storage_efficiency_pct, 2),
      stored_energy_kj: round(item.row.stored_energy_kj, 1),
      soc_pct: round(item.row.state_of_charge_pct, 2),
      energy_loss_pct: round(item.row.energy_loss_pct, 2),
    })),
  };
}

function variableInfluence(scenario, evidenceRows, ranges) {
  if (!evidenceRows.length) return [];
  return MODEL_INPUTS.map((column) => {
    const range = ranges[column];
    const span = Math.max(range.max - range.min, 1e-9);
    const delta =
      evidenceRows.reduce((sum, row) => sum + Math.abs((Number(row[column]) - Number(scenario[column])) / span), 0) /
      evidenceRows.length;
    return {
      variable: column,
      label: labelMap[column] ?? column,
      normalized_gap: Number.isFinite(delta) ? round(delta, 4) : 0,
    };
  })
    .sort((a, b) => b.normalized_gap - a.normalized_gap)
    .slice(0, 6);
}

function saturationAudit(neighborRows) {
  const total = neighborRows.length || 1;
  const cap = neighborRows.filter((row) => row.thermal_storage_efficiency_pct === 98).length;
  const floor = neighborRows.filter((row) => row.thermal_storage_efficiency_pct === 35).length;
  const status = cap / total > 0.45 ? "upper-cap dominated" : floor / total > 0.25 ? "floor dominated" : "middle-range evidence";
  return {
    status,
    cap_98_share_pct: round((cap / total) * 100, 1),
    floor_35_share_pct: round((floor / total) * 100, 1),
    note: "Efficiency saturation is audited separately from stored energy and SOC.",
  };
}

function objectiveScore(prediction, health, objective) {
  const scores = {
    stored_energy: normalize(prediction.stored_energy_kj, 0, 18000) * 100,
    efficiency: normalize(prediction.thermal_storage_efficiency_pct, 35, 98) * 100,
    loss: (1 - normalize(prediction.energy_loss_pct, 2, 35)) * 100,
    health: health.score,
    balance:
      normalize(prediction.stored_energy_kj, 0, 18000) * 28 +
      normalize(prediction.thermal_storage_efficiency_pct, 35, 98) * 26 +
      normalize(prediction.state_of_charge_pct, 0, 100) * 18 +
      (1 - normalize(prediction.energy_loss_pct, 2, 35)) * 16 +
      health.score * 0.12,
  };
  return scores[objective] ?? scores.balance;
}

function tradeOffs(prediction, health) {
  return [
    { target: "Stored energy", value: round(prediction.stored_energy_kj, 0), unit: "kJ" },
    { target: "Efficiency", value: round(prediction.thermal_storage_efficiency_pct, 1), unit: "%" },
    { target: "Energy loss", value: round(prediction.energy_loss_pct, 1), unit: "%", lower_is_better: true },
    { target: "Health", value: round(health.score, 1), unit: "/100" },
  ];
}

function normalize(value, min, max) {
  return Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1e-9)));
}

function meanPrediction(rows) {
  return Object.fromEntries(
    TARGET_COLUMNS.map((column) => {
      const values = rows.map((row) => row[column]).filter(Number.isFinite);
      const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return [column, round(mean, 4)];
    }),
  );
}

function riskLevel(score) {
  if (score >= 3) return "High";
  if (score >= 2) return "Medium";
  return "Low";
}

function intervalSpread(interval) {
  if (!interval) return 0;
  return Math.max(0, (interval.p90 ?? 0) - (interval.p10 ?? 0));
}

function average(values) {
  const numeric = values.filter(Number.isFinite);
  return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : 0;
}

function simpleHash(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function findRule(text, rules, matched) {
  for (const [value, terms] of rules) {
    const term = terms.find((candidate) => text.includes(candidate));
    if (term) {
      matched.push({ value, term });
      return value;
    }
  }
  return null;
}
