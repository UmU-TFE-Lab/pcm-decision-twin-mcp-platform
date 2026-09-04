import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRanges,
  clearAnalyticsCache,
  defaultScenario,
  getAnalyticsCacheStats,
  predictBySimilarity,
} from "../../src/analytics.js";
import { loadTestRows, TEST_SCENARIO } from "../helpers/loadRows.mjs";

test("similarity estimator returns ordered, normalized evidence", () => {
  const rows = loadTestRows();
  clearAnalyticsCache(rows);
  const scenario = { ...defaultScenario(rows), ...TEST_SCENARIO };
  const result = predictBySimilarity(rows, scenario, buildRanges(rows));

  assert.equal(result.sampleSize, 220);
  assert.equal(result.evidence.length, 220);
  assert.ok(result.exactCategoryRows >= 80);
  assert.ok(result.evidence.every((item, index, evidence) => (
    Number.isFinite(item.distance) &&
    Number.isFinite(item.weight) &&
    (index === 0 || item.distance >= evidence[index - 1].distance)
  )));
  const weightSum = result.evidence.reduce((sum, item) => sum + item.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-10);
  assert.ok(result.prediction.state_of_charge_pct >= 0 && result.prediction.state_of_charge_pct <= 100);
  assert.ok(result.prediction.thermal_storage_efficiency_pct >= 35);
  assert.ok(result.prediction.thermal_storage_efficiency_pct <= 98);
});

test("identical scenario queries reuse the prediction cache", () => {
  const rows = loadTestRows();
  clearAnalyticsCache(rows);
  const scenario = { ...defaultScenario(rows), ...TEST_SCENARIO };
  const ranges = buildRanges(rows);
  const first = predictBySimilarity(rows, scenario, ranges);
  const second = predictBySimilarity(rows, scenario, ranges);
  const cache = getAnalyticsCacheStats(rows);

  assert.strictEqual(second, first);
  assert.equal(cache.prediction_misses, 1);
  assert.equal(cache.prediction_hits, 1);
  assert.equal(cache.category_partitions, 36);
});
