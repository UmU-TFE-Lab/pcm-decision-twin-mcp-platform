import {
  adaptationMatrix,
  bestOperatingWindows,
  buildRanges,
  buildReport,
  comparePredictions,
  diagnosticRecommendations,
  dataQuality,
  defaultScenario,
  diagnostics,
  filterRows,
  groupBy,
  healthIndex,
  hourlyProfile,
  predictBySimilarity,
  recommend,
  round,
  summarize,
} from "../src/analytics.js";
import {
  explainPrediction,
  generateDecisionPackage as buildDecisionPackage,
  mcpBenchmark,
  optimizePcmDesign,
  runSensitivityAnalysis as runWorkflowSensitivity,
  validateScenario,
} from "../src/agentWorkflow.js";
import { MODEL_INPUTS } from "../src/data.js";
import { loadRows } from "./dataLoader.mjs";

function rowsAndScenario(inputScenario = {}) {
  const rows = loadRows();
  const base = defaultScenario(rows);
  return { rows, scenario: { ...base, ...inputScenario } };
}

function optionalIntInRange(value, name, min, max) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function concisePrediction(twin) {
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

export function getSummary() {
  const rows = loadRows();
  const summary = summarize(rows);
  return {
    count: summary.count,
    time_range: { start: summary.start, end: summary.end },
    mean_efficiency_pct: round(summary.efficiency.mean, 2),
    mean_stored_energy_kj: round(summary.stored.mean, 2),
    mean_soc_pct: round(summary.soc.mean, 2),
    mean_energy_loss_pct: round(summary.loss.mean, 2),
    efficiency_cap_98_count: summary.cap98,
    efficiency_floor_35_count: summary.floor35,
  };
}

export function getDefaultScenario() {
  return defaultScenario(loadRows());
}

export function predictTwinState(input = {}) {
  const { rows, scenario } = rowsAndScenario(input.scenario);
  const ranges = buildRanges(rows);
  const limit = optionalIntInRange(input.limit, "limit", 20, 1000) ?? 220;
  const evidenceLimit = optionalIntInRange(input.evidence_limit, "evidence_limit", 1, 20) ?? 5;
  const twin = predictBySimilarity(rows, scenario, ranges, limit);
  const health = healthIndex(twin.prediction, scenario);
  const validation = validateScenario(rows, scenario);
  const diagnosticItems = diagnostics(twin.prediction, scenario);
  if (validation.exact_category_records < 80) {
    diagnosticItems.unshift({
      level: "Warning",
      title: "Fallback evidence required",
      detail: "The exact material--system--encapsulation category is unsupported or sparse; returned evidence is exploratory rather than direct validation.",
    });
  }
  for (const warning of validation.warnings.filter((item) => /unsupported/i.test(item))) {
    diagnosticItems.unshift({
      level: "Warning",
      title: "Unsupported category",
      detail: warning,
    });
  }
  return {
    scenario,
    validation,
    prediction: concisePrediction(twin),
    health: {
      score: round(health.score, 1),
      status: health.status,
      drivers: health.drivers,
    },
    diagnostics: diagnosticItems,
    diagnostic_recommendations: diagnosticRecommendations(twin.prediction, scenario, health),
    nearest_evidence: twin.evidence.slice(0, evidenceLimit).map(({ row, distance, weight }) => ({
      timestamp: row.timestamp,
      pcm_type: row.pcm_type,
      system_type: row.system_type,
      encapsulation_type: row.encapsulation_type,
      efficiency_pct: row.thermal_storage_efficiency_pct,
      soc_pct: row.state_of_charge_pct,
      stored_energy_kj: row.stored_energy_kj,
      distance: round(distance, 6),
      weight: round(weight, 8),
    })),
  };
}

export function validateScenarioTool(input = {}) {
  const rows = loadRows();
  return validateScenario(rows, input.scenario ?? input);
}

export function explainPredictionTool(input = {}) {
  const rows = loadRows();
  return explainPrediction(rows, input.scenario ?? {}, {
    limit: optionalIntInRange(input.limit, "limit", 20, 1000) ?? 220,
    evidence_limit: optionalIntInRange(input.evidence_limit, "evidence_limit", 1, 20) ?? 8,
    use_fallback: Boolean(input.use_fallback),
  });
}

export function runSensitivityAnalysisTool(input = {}) {
  const rows = loadRows();
  return runWorkflowSensitivity(rows, input.scenario ?? {}, {
    variable: input.variable,
    min: input.min,
    max: input.max,
    steps: optionalIntInRange(input.steps, "steps", 3, 25) ?? 9,
    objective: input.objective,
  });
}

export function optimizePcmDesignTool(input = {}) {
  const rows = loadRows();
  return optimizePcmDesign(rows, input.scenario ?? {}, {
    objective: input.objective,
    allow_system_change: Boolean(input.allow_system_change),
    limit: optionalIntInRange(input.limit, "limit", 1, 24) ?? 8,
  });
}

export function generateDecisionPackageTool(input = {}) {
  const rows = loadRows();
  return buildDecisionPackage(rows, input.scenario ?? {}, {
    objective: input.objective,
    sensitivity_variable: input.sensitivity_variable,
    sensitivity_steps: optionalIntInRange(input.sensitivity_steps, "sensitivity_steps", 3, 25) ?? 7,
    evidence_limit: optionalIntInRange(input.evidence_limit, "evidence_limit", 1, 20) ?? 6,
    use_fallback: Boolean(input.use_fallback),
    full_analysis: Boolean(input.full_analysis),
    constraints: input.constraints ?? {},
    task_text: input.task_text ?? "",
  });
}

export function getMcpBenchmark() {
  return mcpBenchmark(loadRows());
}

export function runWhatIf(input = {}) {
  const { rows, scenario: baseScenario } = rowsAndScenario(input.base_scenario);
  const ranges = buildRanges(rows);
  const candidateScenario = {
    ...baseScenario,
    ...(input.candidate_scenario ?? {}),
    ...(input.candidate_overrides ?? {}),
  };
  const baseTwin = predictBySimilarity(rows, baseScenario, ranges);
  const candidateTwin = predictBySimilarity(rows, candidateScenario, ranges);
  return {
    base_scenario: baseScenario,
    candidate_scenario: candidateScenario,
    base_prediction: concisePrediction(baseTwin),
    candidate_prediction: concisePrediction(candidateTwin),
    delta: comparePredictions(baseTwin.prediction, candidateTwin.prediction),
  };
}

export function recommendDesign(input = {}) {
  const { rows, scenario } = rowsAndScenario(input.scenario);
  const recommendationScenario = {
    ...scenario,
    ...(input.system_type ? { system_type: input.system_type } : {}),
    ...(Number.isFinite(input.air_temperature_c) ? { air_temperature_c: input.air_temperature_c } : {}),
    ...(Number.isFinite(input.solar_irradiance_wm2) ? { solar_irradiance_wm2: input.solar_irradiance_wm2 } : {}),
    ...(Number.isFinite(input.inlet_fluid_temp_c) ? { inlet_fluid_temp_c: input.inlet_fluid_temp_c } : {}),
  };
  return {
    scenario: recommendationScenario,
    recommendations: recommend(rows, recommendationScenario).map((item) => ({
      combination: item.key,
      score: round(item.score * 100, 1),
      rows: item.count,
      efficiency_pct: round(item.efficiency, 1),
      stored_energy_kj: round(item.stored, 0),
      energy_loss_pct: round(item.loss, 1),
      soc_pct: round(item.soc, 1),
    })),
  };
}

export function generateReport(input = {}) {
  const { rows, scenario } = rowsAndScenario(input.scenario);
  const ranges = buildRanges(rows);
  const twin = predictBySimilarity(rows, scenario, ranges);
  const health = healthIndex(twin.prediction, scenario);
  const diagnosticItems = diagnostics(twin.prediction, scenario);
  const recommendations = recommend(rows, scenario);
  return buildReport({
    scenario,
    twin,
    health,
    diagnostics: diagnosticItems,
    recommendations,
  });
}

export function getOperatingWindows(input = {}) {
  const { rows, scenario } = rowsAndScenario(input.scenario);
  const profile = hourlyProfile(rows, scenario);
  return {
    scenario,
    best_windows: bestOperatingWindows(profile).map((item) => ({
      hour: item.hour,
      score: round(item.score * 100, 1),
      efficiency_pct: round(item.efficiency, 1),
      soc_pct: round(item.soc, 1),
      stored_energy_kj: round(item.stored, 0),
      phase_fraction: round(item.phase, 4),
    })),
    hourly_profile: profile.map((item) => ({
      hour: item.hour,
      efficiency_pct: round(item.efficiency, 1),
      soc_pct: round(item.soc, 1),
      stored_energy_kj: round(item.stored, 0),
      phase_fraction: round(item.phase, 4),
      solar_irradiance_wm2: round(item.solar, 1),
    })),
  };
}

export function describeInputs() {
  const ranges = buildRanges(loadRows());
  return {
    model_inputs: MODEL_INPUTS,
    ranges,
    default_scenario: getDefaultScenario(),
  };
}

export function filterRecords(input = {}) {
  const rows = loadRows();
  const ranges = buildRanges(rows);
  const filters = {
    pcm_type: input.pcm_type ?? "All",
    system_type: input.system_type ?? "All",
    encapsulation_type: input.encapsulation_type ?? "All",
    solarMin: input.solar_min ?? ranges.solar_irradiance_wm2.min,
    solarMax: input.solar_max ?? ranges.solar_irradiance_wm2.max,
    cycleMin: input.cycle_min ?? ranges.cycle_number.min,
    cycleMax: input.cycle_max ?? ranges.cycle_number.max,
  };
  const filtered = filterRows(rows, filters);
  return {
    filters,
    quality: dataQuality(filtered),
    summary: summarize(filtered),
    sample: filtered.slice(0, input.limit ?? 10).map((row) => ({
      timestamp: row.timestamp,
      pcm_type: row.pcm_type,
      system_type: row.system_type,
      encapsulation_type: row.encapsulation_type,
      efficiency_pct: row.thermal_storage_efficiency_pct,
      soc_pct: row.state_of_charge_pct,
      stored_energy_kj: row.stored_energy_kj,
      energy_loss_pct: row.energy_loss_pct,
    })),
  };
}

export function compareGroups(input = {}) {
  const rows = loadRows();
  const filters = {
    pcm_type: input.pcm_type ?? "All",
    system_type: input.system_type ?? "All",
    encapsulation_type: input.encapsulation_type ?? "All",
    solarMin: input.solar_min ?? 0,
    solarMax: input.solar_max ?? 1000,
    cycleMin: input.cycle_min ?? 0,
    cycleMax: input.cycle_max ?? 3000,
  };
  const groupColumns = input.group_by?.length ? input.group_by : ["pcm_type", "system_type"];
  return {
    filters,
    group_by: groupColumns,
    groups: groupBy(filterRows(rows, filters), groupColumns)
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, input.limit ?? 20)
      .map((item) => ({
        combination: item.key,
        rows: item.count,
        efficiency_pct: round(item.efficiency, 2),
        stored_energy_kj: round(item.stored, 0),
        soc_pct: round(item.soc, 2),
        phase_fraction: round(item.phase, 4),
        energy_loss_pct: round(item.loss, 2),
      })),
  };
}

export function evaluateCandidates(input = {}) {
  const { rows, scenario: baseScenario } = rowsAndScenario(input.base_scenario);
  const ranges = buildRanges(rows);
  const candidates = input.candidates?.length ? input.candidates : [
    { name: "Macro lower melting point", encapsulation_type: "Macro", melting_point_c: baseScenario.melting_point_c - 2 },
    { name: "Micro higher flow", encapsulation_type: "Micro", mass_flow_rate_kgs: baseScenario.mass_flow_rate_kgs * 1.35 },
    { name: "Shape stabilized high mass", encapsulation_type: "ShapeStabilized", pcm_mass_kg: baseScenario.pcm_mass_kg * 1.2 },
  ];
  const baseTwin = predictBySimilarity(rows, baseScenario, ranges);
  const evaluated = candidates.map((candidate, index) => {
    const scenario = { ...baseScenario, ...candidate };
    const twin = predictBySimilarity(rows, scenario, ranges);
    const health = healthIndex(twin.prediction, scenario);
    const score =
      twin.prediction.thermal_storage_efficiency_pct * 0.34 +
      Math.min(twin.prediction.stored_energy_kj / 180, 100) * 0.24 +
      twin.prediction.state_of_charge_pct * 0.18 -
      twin.prediction.energy_loss_pct * 0.12 +
      health.score * 0.12;
    return {
      rank_seed: index + 1,
      name: candidate.name ?? `Candidate ${index + 1}`,
      scenario,
      score: round(score, 2),
      health: { score: round(health.score, 1), status: health.status },
      prediction: concisePrediction(twin),
      delta: comparePredictions(baseTwin.prediction, twin.prediction),
    };
  }).sort((a, b) => b.score - a.score);

  return {
    base_scenario: baseScenario,
    base_prediction: concisePrediction(baseTwin),
    candidates: evaluated,
  };
}

export function diagnoseAndRecommend(input = {}) {
  const predictionResult = predictTwinState(input);
  const recommendations = recommendDesign({ scenario: predictionResult.scenario }).recommendations;
  const windows = getOperatingWindows({ scenario: predictionResult.scenario }).best_windows;
  const matrix = adaptationMatrix(loadRows(), predictionResult.scenario.system_type);
  return {
    scenario: predictionResult.scenario,
    prediction: predictionResult.prediction,
    health: predictionResult.health,
    diagnostics: predictionResult.diagnostics,
    diagnostic_recommendations: predictionResult.diagnostic_recommendations,
    top_recommendations: recommendations.slice(0, 3),
    best_operating_windows: windows,
    fit_matrix: matrix.cells.map((cell) => ({
      pcm_type: cell.pcm,
      encapsulation_type: cell.encapsulation,
      score: round(cell.score * 100, 1),
      efficiency_pct: cell.group ? round(cell.group.efficiency, 1) : null,
    })),
  };
}

export function getDatasetSchemaResource() {
  return {
    categories: {
      pcm_type: ["Organic_Paraffin", "Inorganic_SaltHydrate", "Eutectic"],
      system_type: ["BuildingEnvelope", "SolarTES", "HVACStorage", "BatteryCooling"],
      encapsulation_type: ["Macro", "Micro", "ShapeStabilized"],
    },
    ...describeInputs(),
  };
}
