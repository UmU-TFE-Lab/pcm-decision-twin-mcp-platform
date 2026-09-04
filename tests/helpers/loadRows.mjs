import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../src/data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let rows;

export function loadTestRows() {
  if (!rows) {
    rows = parseCsv(fs.readFileSync(path.resolve(ROOT, "pcm_thermal_storage.csv"), "utf8"));
  }
  return rows;
}

export const TEST_SCENARIO = {
  system_type: "BuildingEnvelope",
  pcm_type: "Organic_Paraffin",
  encapsulation_type: "ShapeStabilized",
  air_temperature_c: 32,
  solar_irradiance_wm2: 760,
  inlet_fluid_temp_c: 30,
  mass_flow_rate_kgs: 0.16,
};
