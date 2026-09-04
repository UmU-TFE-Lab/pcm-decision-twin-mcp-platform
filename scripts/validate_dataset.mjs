import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadRows } from "../mcp_server/dataLoader.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const csvPath = path.resolve(ROOT, "pcm_thermal_storage.csv");
const release = JSON.parse(fs.readFileSync(path.resolve(ROOT, "release_manifest.json"), "utf8"));
const dictionaryLines = fs.readFileSync(path.resolve(ROOT, "data", "field_dictionary.csv"), "utf8").trim().split(/\r?\n/);
const csvText = fs.readFileSync(csvPath, "utf8");
const header = csvText.slice(0, csvText.indexOf("\n")).trim().split(",");
const rows = loadRows(csvPath);

function countBy(column) {
  const counts = {};
  for (const row of rows) counts[row[column]] = (counts[row[column]] || 0) + 1;
  return counts;
}

function allBetween(column, min, max) {
  return rows.every((row) => Number.isFinite(row[column]) && row[column] >= min && row[column] <= max);
}

const sha256 = crypto.createHash("sha256").update(csvText).digest("hex");
const checks = {
  sha256_matches_release: sha256 === release.dataset.sha256,
  row_count_50000: rows.length === release.dataset.rows,
  field_count_33: header.length === release.dataset.fields,
  dictionary_covers_all_fields: dictionaryLines.length - 1 === header.length,
  timestamps_match_release: rows[0].timestamp === "2023-01-01 00:00:00" && rows.at(-1).timestamp === "2028-09-14 07:00:00",
  numeric_values_finite: rows.every((row) => header.slice(4).every((column) => Number.isFinite(row[column]))),
  phase_fraction_bounded: allBetween("phase_fraction", 0, 1),
  state_of_charge_bounded: allBetween("state_of_charge_pct", 0, 100),
  energy_loss_bounded: allBetween("energy_loss_pct", 2, 35),
  efficiency_bounded: allBetween("thermal_storage_efficiency_pct", 35, 98),
  temperature_difference_consistent: rows.every((row) => Math.abs(row.temp_difference_c - (row.inlet_fluid_temp_c - row.melting_point_c)) <= 0.020001),
  stored_energy_nonnegative: rows.every((row) => row.stored_energy_kj >= 0),
  energy_input_nonnegative: rows.every((row) => row.energy_input_kj >= 0),
};

const manifest = {
  dataset_version: release.dataset.version,
  generated_at: new Date().toISOString(),
  release_mode: "frozen_canonical_csv",
  exact_original_generator_available: false,
  file: release.dataset.file,
  sha256,
  rows: rows.length,
  fields: header.length,
  columns: header,
  time_range: { start: rows[0].timestamp, end: rows.at(-1).timestamp },
  category_counts: {
    pcm_type: countBy("pcm_type"),
    system_type: countBy("system_type"),
    encapsulation_type: countBy("encapsulation_type"),
  },
  saturation: {
    efficiency_cap_98: rows.filter((row) => row.thermal_storage_efficiency_pct === 98).length,
    efficiency_floor_35: rows.filter((row) => row.thermal_storage_efficiency_pct === 35).length,
  },
  checks,
  passed: Object.values(checks).every(Boolean),
};

fs.writeFileSync(path.resolve(ROOT, "data", "dataset_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
if (!manifest.passed) process.exitCode = 1;
