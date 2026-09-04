import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_COLUMNS = new Set([
  "timestamp",
  "pcm_type",
  "system_type",
  "encapsulation_type",
]);

const DEFAULT_DATASET = path.resolve(__dirname, "../pcm_thermal_storage.csv");

let cache = null;

export function loadRows(datasetPath = process.env.PCM_DATASET_PATH || DEFAULT_DATASET) {
  if (cache?.datasetPath === datasetPath) return cache.rows;

  const text = fs.readFileSync(datasetPath, "utf8").trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const columns = headerLine.split(",");
  const rows = lines.map((line) => {
    const values = line.split(",");
    const row = {};
    columns.forEach((column, index) => {
      const value = values[index];
      row[column] = CATEGORY_COLUMNS.has(column) ? value : Number(value);
    });
    const date = new Date(row.timestamp.replace(" ", "T"));
    row.hour = date.getHours();
    row.month = date.getMonth() + 1;
    row.temp_match_c = row.inlet_fluid_temp_c - row.melting_point_c;
    return row;
  });

  cache = { datasetPath, rows };
  return rows;
}
