import { MODEL_INPUTS, TARGET_COLUMNS } from "./data.js";

const ANALYTICS_CACHE = new WeakMap();
const MAX_PREDICTION_CACHE = 2048;

function datasetCache(rows) {
  if (!ANALYTICS_CACHE.has(rows)) {
    ANALYTICS_CACHE.set(rows, {
      ranges: new Map(),
      defaultScenario: null,
      categoryIndex: null,
      predictions: new Map(),
      predictionHits: 0,
      predictionMisses: 0,
    });
  }
  return ANALYTICS_CACHE.get(rows);
}

function categoryKey(pcmType, systemType, encapsulationType) {
  return `${pcmType}\u0001${systemType}\u0001${encapsulationType}`;
}

function getCategoryIndex(rows) {
  const cache = datasetCache(rows);
  if (cache.categoryIndex) return cache.categoryIndex;
  const index = new Map();
  for (const row of rows) {
    const key = categoryKey(row.pcm_type, row.system_type, row.encapsulation_type);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  cache.categoryIndex = index;
  return index;
}

function predictionKey(scenario, limit) {
  return JSON.stringify([
    scenario.pcm_type,
    scenario.system_type,
    scenario.encapsulation_type,
    limit,
    ...MODEL_INPUTS.map((column) => scenario[column]),
  ]);
}

function setPredictionCache(cache, key, value) {
  if (cache.predictions.size >= MAX_PREDICTION_CACHE) {
    cache.predictions.delete(cache.predictions.keys().next().value);
  }
  cache.predictions.set(key, value);
}

export function summarize(rows) {
  if (!rows.length) return null;
  const timestamps = rows.map((row) => row.timestamp);
  return {
    count: rows.length,
    start: timestamps[0],
    end: timestamps[timestamps.length - 1],
    efficiency: stats(rows, "thermal_storage_efficiency_pct"),
    stored: stats(rows, "stored_energy_kj"),
    soc: stats(rows, "state_of_charge_pct"),
    loss: stats(rows, "energy_loss_pct"),
    phase: stats(rows, "phase_fraction"),
    cap98: rows.filter((row) => row.thermal_storage_efficiency_pct === 98).length,
    floor35: rows.filter((row) => row.thermal_storage_efficiency_pct === 35).length,
  };
}

export function stats(rows, column) {
  const values = rows.map((row) => row[column]).filter(Number.isFinite);
  if (!values.length) return { mean: 0, min: 0, max: 0, p50: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
  };
}

export function categories(rows, column) {
  return [...new Set(rows.map((row) => row[column]))].sort();
}

export function groupBy(rows, columns) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = columns.map((column) => row[column]).join(" | ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    count: groupRows.length,
    efficiency: stats(groupRows, "thermal_storage_efficiency_pct").mean,
    stored: stats(groupRows, "stored_energy_kj").mean,
    loss: stats(groupRows, "energy_loss_pct").mean,
    soc: stats(groupRows, "state_of_charge_pct").mean,
    phase: stats(groupRows, "phase_fraction").mean,
  }));
}

export function buildRanges(rows, columns = MODEL_INPUTS) {
  const cache = datasetCache(rows);
  const key = columns.join("|");
  if (cache.ranges.has(key)) return cache.ranges.get(key);
  const ranges = Object.fromEntries(
    columns.map((column) => {
      const s = stats(rows, column);
      return [column, { min: s.min, max: s.max, mean: s.mean, p50: s.p50 }];
    }),
  );
  cache.ranges.set(key, ranges);
  return ranges;
}

export function defaultScenario(rows) {
  const cache = datasetCache(rows);
  if (cache.defaultScenario) return { ...cache.defaultScenario };
  const ranges = buildRanges(rows);
  const scenario = {
    pcm_type: "Organic_Paraffin",
    system_type: "BuildingEnvelope",
    encapsulation_type: "ShapeStabilized",
    ...Object.fromEntries(
      MODEL_INPUTS.map((column) => [column, round(ranges[column]?.p50 ?? 0, 3)]),
    ),
  };
  cache.defaultScenario = scenario;
  return { ...scenario };
}

export function predictBySimilarity(rows, scenario, ranges, limit = 220) {
  const cache = datasetCache(rows);
  const key = predictionKey(scenario, limit);
  if (cache.predictions.has(key)) {
    cache.predictionHits += 1;
    return cache.predictions.get(key);
  }
  cache.predictionMisses += 1;
  const categoryFiltered = getCategoryIndex(rows).get(
    categoryKey(scenario.pcm_type, scenario.system_type, scenario.encapsulation_type),
  ) ?? [];
  const pool = categoryFiltered.length >= 80 ? categoryFiltered : rows;

  const nearest = pool
    .map((row) => {
      const distance = MODEL_INPUTS.reduce((sum, column) => {
        const range = ranges[column];
        const span = Math.max((range?.max ?? 1) - (range?.min ?? 0), 1e-9);
        return sum + Math.abs((row[column] - scenario[column]) / span);
      }, 0);
      return { row, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

  const weightSum = nearest.reduce((sum, item) => sum + 1 / (item.distance + 0.025), 0);
  const prediction = Object.fromEntries(
    TARGET_COLUMNS.map((column) => {
      const value = nearest.reduce(
        (sum, item) => sum + item.row[column] * (1 / (item.distance + 0.025)),
        0,
      ) / weightSum;
      return [column, value];
    }),
  );

  const result = {
    prediction,
    neighbors: nearest.map((item) => item.row),
    evidence: nearest.map((item) => ({
      row: item.row,
      distance: item.distance,
      weight: (1 / (item.distance + 0.025)) / weightSum,
    })),
    intervals: predictionIntervals(nearest.map((item) => item.row)),
    dataSupportScore: Math.max(0, Math.min(100, 100 - nearest[0].distance * 28)),
    sampleSize: nearest.length,
    exactCategoryRows: categoryFiltered.length,
  };
  setPredictionCache(cache, key, result);
  return result;
}

export function getAnalyticsCacheStats(rows) {
  const cache = datasetCache(rows);
  return {
    prediction_entries: cache.predictions.size,
    prediction_hits: cache.predictionHits,
    prediction_misses: cache.predictionMisses,
    category_partitions: cache.categoryIndex?.size ?? 0,
    range_sets: cache.ranges.size,
  };
}

export function clearAnalyticsCache(rows) {
  ANALYTICS_CACHE.delete(rows);
}

export function diagnostics(prediction, scenario) {
  const items = [];
  if (prediction.phase_fraction < 0.1) {
    items.push({
      level: "Warning",
      title: "Phase change is barely activated",
      detail: "The selected condition is likely outside the effective latent-heat window.",
    });
  } else if (prediction.phase_fraction > 0.65) {
    items.push({
      level: "Good",
      title: "Strong phase-change participation",
      detail: "The PCM is expected to operate inside a useful latent-heat region.",
    });
  }

  if (prediction.state_of_charge_pct < 20) {
    items.push({
      level: "Warning",
      title: "Low state of charge",
      detail: "Stored thermal capacity is limited under this scenario.",
    });
  } else if (prediction.state_of_charge_pct > 70) {
    items.push({
      level: "Good",
      title: "High charge state",
      detail: "The system is close to a productive charging regime.",
    });
  }

  if (prediction.energy_loss_pct > 25) {
    items.push({
      level: "Risk",
      title: "Energy loss is high",
      detail: "Review insulation, charge duration, flow rate, and cycle ageing.",
    });
  }

  if (scenario.cycle_number > 2000) {
    items.push({
      level: "Risk",
      title: "Late-life cycle range",
      detail: "The scenario falls into the dataset region with elevated degradation losses.",
    });
  }

  if (prediction.thermal_storage_efficiency_pct >= 95) {
    items.push({
      level: "Good",
      title: "High-efficiency operating point",
      detail: "The nearby scenario records cluster near the upper efficiency band.",
    });
  }

  return items.length
    ? items
    : [
        {
          level: "Info",
          title: "Stable middle operating region",
          detail: "No severe risk marker is triggered by the current scenario.",
        },
      ];
}

export function recommend(rows, scenario) {
  const climateMatch = rows.filter((row) => {
    const air = Math.abs(row.air_temperature_c - scenario.air_temperature_c) < 4;
    const inlet = Math.abs(row.inlet_fluid_temp_c - scenario.inlet_fluid_temp_c) < 5;
    const solar = Math.abs(row.solar_irradiance_wm2 - scenario.solar_irradiance_wm2) < 160;
    return row.system_type === scenario.system_type && air && inlet && solar;
  });
  const pool = climateMatch.length >= 250
    ? climateMatch
    : rows.filter((row) => row.system_type === scenario.system_type);

  return groupBy(pool, ["pcm_type", "encapsulation_type"])
    .map((group) => {
      const score =
        normalize(group.efficiency, 35, 98) * 0.36 +
        normalize(group.stored, 0, 18000) * 0.28 +
        normalize(group.soc, 0, 100) * 0.22 -
        normalize(group.loss, 2, 35) * 0.14;
      return { ...group, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function healthIndex(prediction, scenario) {
  const lossPenalty = normalize(prediction.energy_loss_pct, 12, 35) * 28;
  const cyclePenalty = normalize(scenario.cycle_number, 1200, 2500) * 18;
  const degradationPenalty = normalize(1 - prediction.degradation_factor, 0.02, 0.18) * 34;
  const lowSocPenalty = normalize(35 - prediction.state_of_charge_pct, 0, 35) * 12;
  const phasePenalty = normalize(0.18 - prediction.phase_fraction, 0, 0.18) * 8;
  const score = Math.max(
    0,
    Math.min(100, 100 - lossPenalty - cyclePenalty - degradationPenalty - lowSocPenalty - phasePenalty),
  );

  let status = "Healthy";
  if (score < 45) status = "Replace soon";
  else if (score < 65) status = "Degraded";
  else if (score < 80) status = "Watch";

  return {
    score,
    status,
    drivers: [
      { label: "Energy loss", value: prediction.energy_loss_pct, unit: "%", risk: lossPenalty },
      { label: "Cycle ageing", value: scenario.cycle_number, unit: " cycles", risk: cyclePenalty },
      { label: "Degradation", value: prediction.degradation_factor, unit: "", risk: degradationPenalty },
      { label: "SOC reserve", value: prediction.state_of_charge_pct, unit: "%", risk: lowSocPenalty },
    ].sort((a, b) => b.risk - a.risk),
  };
}

export function adaptationMatrix(rows, systemType) {
  const pool = rows.filter((row) => row.system_type === systemType);
  const pcmTypes = categories(pool, "pcm_type");
  const encapsulations = categories(pool, "encapsulation_type");
  const groups = groupBy(pool, ["pcm_type", "encapsulation_type"]);
  const lookup = new Map(groups.map((group) => [group.key, group]));

  return {
    pcmTypes,
    encapsulations,
    cells: pcmTypes.flatMap((pcm) =>
      encapsulations.map((encapsulation) => {
        const group = lookup.get(`${pcm} | ${encapsulation}`);
        if (!group) return { pcm, encapsulation, score: 0, group: null };
        const score =
          normalize(group.efficiency, 35, 98) * 0.38 +
          normalize(group.stored, 0, 14000) * 0.28 +
          normalize(group.soc, 0, 100) * 0.2 -
          normalize(group.loss, 2, 35) * 0.14;
        return { pcm, encapsulation, score, group };
      }),
    ),
  };
}

export function comparePredictions(base, candidate) {
  return {
    efficiency: candidate.thermal_storage_efficiency_pct - base.thermal_storage_efficiency_pct,
    stored: candidate.stored_energy_kj - base.stored_energy_kj,
    soc: candidate.state_of_charge_pct - base.state_of_charge_pct,
    loss: candidate.energy_loss_pct - base.energy_loss_pct,
    phase: candidate.phase_fraction - base.phase_fraction,
  };
}

export function buildReport({ scenario, twin, health, diagnostics, recommendations }) {
  const prediction = twin.prediction;
  return {
    generated_at: new Date().toISOString(),
    scenario,
    prediction: {
      phase_fraction: round(prediction.phase_fraction, 4),
      state_of_charge_pct: round(prediction.state_of_charge_pct, 2),
      stored_energy_kj: round(prediction.stored_energy_kj, 2),
      thermal_storage_efficiency_pct: round(prediction.thermal_storage_efficiency_pct, 2),
      energy_loss_pct: round(prediction.energy_loss_pct, 2),
      degradation_factor: round(prediction.degradation_factor, 4),
    },
    data_support_score: round(twin.dataSupportScore, 1),
    health: {
      index: round(health.score, 1),
      status: health.status,
      top_driver: health.drivers[0]?.label ?? "None",
    },
    diagnostics: diagnostics.map((item) => ({
      level: item.level,
      title: item.title,
      detail: item.detail,
    })),
    recommendations: recommendations.slice(0, 3).map((item) => ({
      combination: item.key,
      score: round(item.score * 100, 1),
      efficiency_pct: round(item.efficiency, 1),
      stored_energy_kj: round(item.stored, 0),
      energy_loss_pct: round(item.loss, 1),
    })),
  };
}

export function predictionIntervals(neighborRows) {
  return Object.fromEntries(
    TARGET_COLUMNS.map((column) => {
      const values = neighborRows
        .map((row) => row[column])
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return [
        column,
        {
          p10: quantile(values, 0.1),
          p50: quantile(values, 0.5),
          p90: quantile(values, 0.9),
        },
      ];
    }),
  );
}

export function diagnosticRecommendations(prediction, scenario, health) {
  const advice = [];
  const tempMatch = scenario.inlet_fluid_temp_c - scenario.melting_point_c;

  if (prediction.phase_fraction < 0.2 && tempMatch < 0) {
    advice.push({
      mode: "Raise charge temperature",
      impact: "Phase activation",
      detail: "Inlet temperature is below the melting point, so the latent-heat window is weakly activated.",
    });
  }

  if (prediction.state_of_charge_pct < 25) {
    advice.push({
      mode: "Extend charging window",
      impact: "SOC recovery",
      detail: "Nearest operating states indicate low charge reserve under this scenario.",
    });
  }

  if (prediction.energy_loss_pct > 23) {
    advice.push({
      mode: "Audit losses",
      impact: "Efficiency protection",
      detail: "Energy loss is in the upper operating range; check insulation and flow-duration pairing.",
    });
  }

  if (scenario.mass_flow_rate_kgs < 0.09) {
    advice.push({
      mode: "Increase mass flow",
      impact: "Heat transfer",
      detail: "Current flow is near the low end of the dataset and may limit charge/discharge rate.",
    });
  } else if (scenario.mass_flow_rate_kgs > 0.26) {
    advice.push({
      mode: "Reduce flow sweep",
      impact: "Residence time",
      detail: "Very high flow can reduce residence time; compare against a medium-flow What-if case.",
    });
  }

  if (health.score < 65) {
    advice.push({
      mode: "Plan maintenance",
      impact: "Lifecycle risk",
      detail: "Health index is degraded; prioritize inspection before pushing higher cycling intensity.",
    });
  }

  if (!advice.length) {
    advice.push({
      mode: "Hold operating point",
      impact: "Stable state",
      detail: "No strong corrective action is triggered by the current data-driven twin state.",
    });
  }

  return advice.slice(0, 4);
}

export function filterRows(rows, filters) {
  return rows.filter((row) => {
    const categoryMatch =
      (filters.pcm_type === "All" || row.pcm_type === filters.pcm_type) &&
      (filters.system_type === "All" || row.system_type === filters.system_type) &&
      (filters.encapsulation_type === "All" || row.encapsulation_type === filters.encapsulation_type);
    const solarMatch =
      row.solar_irradiance_wm2 >= filters.solarMin &&
      row.solar_irradiance_wm2 <= filters.solarMax;
    const cycleMatch =
      row.cycle_number >= filters.cycleMin &&
      row.cycle_number <= filters.cycleMax;
    return categoryMatch && solarMatch && cycleMatch;
  });
}

export function dataQuality(rows) {
  const duplicateKeys = new Set();
  let duplicateCount = 0;
  rows.forEach((row) => {
    const key = `${row.timestamp}-${row.pcm_type}-${row.system_type}-${row.encapsulation_type}`;
    if (duplicateKeys.has(key)) duplicateCount += 1;
    duplicateKeys.add(key);
  });

  return {
    rows: rows.length,
    duplicateCount,
    efficiencyCapPct: rows.length
      ? (rows.filter((row) => row.thermal_storage_efficiency_pct === 98).length / rows.length) * 100
      : 0,
    efficiencyFloorPct: rows.length
      ? (rows.filter((row) => row.thermal_storage_efficiency_pct === 35).length / rows.length) * 100
      : 0,
    highLossCount: rows.filter((row) => row.energy_loss_pct > 25).length,
  };
}

export function hourlyProfile(rows, scenario) {
  const categoryPool = rows.filter(
    (row) =>
      row.system_type === scenario.system_type &&
      row.pcm_type === scenario.pcm_type &&
      row.encapsulation_type === scenario.encapsulation_type,
  );
  const pool = categoryPool.length >= 240
    ? categoryPool
    : rows.filter((row) => row.system_type === scenario.system_type);

  return Array.from({ length: 24 }, (_, hour) => {
    const hourRows = pool.filter((row) => row.hour === hour);
    return {
      hour,
      count: hourRows.length,
      efficiency: stats(hourRows, "thermal_storage_efficiency_pct").mean,
      stored: stats(hourRows, "stored_energy_kj").mean,
      soc: stats(hourRows, "state_of_charge_pct").mean,
      phase: stats(hourRows, "phase_fraction").mean,
      solar: stats(hourRows, "solar_irradiance_wm2").mean,
    };
  });
}

export function bestOperatingWindows(profile) {
  return [...profile]
    .filter((point) => point.count > 0)
    .map((point) => {
      const score =
        normalize(point.efficiency, 35, 98) * 0.34 +
        normalize(point.stored, 0, 16000) * 0.3 +
        normalize(point.soc, 0, 100) * 0.24 +
        normalize(point.phase, 0, 1) * 0.12;
      return { ...point, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function quantile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function normalize(value, min, max) {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}
