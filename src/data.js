const CATEGORY_COLUMNS = new Set([
  "timestamp",
  "pcm_type",
  "system_type",
  "encapsulation_type",
]);

export const TARGET_COLUMNS = [
  "degradation_factor",
  "phase_fraction",
  "state_of_charge_pct",
  "stored_energy_kj",
  "energy_loss_pct",
  "thermal_storage_efficiency_pct",
];

export const MODEL_INPUTS = [
  "air_temperature_c",
  "relative_humidity_pct",
  "wind_speed_mps",
  "cloud_cover_pct",
  "solar_irradiance_wm2",
  "inlet_fluid_temp_c",
  "melting_point_c",
  "latent_heat_kjkg",
  "thermal_conductivity_wmk",
  "density_kgm3",
  "specific_heat_jkgk",
  "pcm_mass_kg",
  "surface_area_m2",
  "pcm_thickness_mm",
  "mass_flow_rate_kgs",
  "cycle_number",
];

export const STATE_INPUTS = [
  "degradation_factor",
  "temp_difference_c",
  "phase_fraction",
  "heat_transfer_coeff_wm2k",
  "heat_flux_wm2",
  "energy_input_kj",
  "charging_time_min",
  "discharging_time_min",
];

export async function loadPcmData() {
  const response = await fetch("/pcm_thermal_storage.csv");
  if (!response.ok) {
    throw new Error(`Unable to load CSV: ${response.status}`);
  }

  const text = await response.text();
  return parseCsv(text);
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const columns = lines[0].split(",");

  return lines.slice(1).map((line) => {
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
}

export const labelMap = {
  pcm_type: "PCM type",
  system_type: "System type",
  encapsulation_type: "Encapsulation",
  air_temperature_c: "Air temp",
  relative_humidity_pct: "Humidity",
  wind_speed_mps: "Wind speed",
  cloud_cover_pct: "Cloud cover",
  solar_irradiance_wm2: "Solar irradiance",
  inlet_fluid_temp_c: "Inlet temp",
  melting_point_c: "Melting point",
  latent_heat_kjkg: "Latent heat",
  thermal_conductivity_wmk: "Conductivity",
  density_kgm3: "Density",
  specific_heat_jkgk: "Specific heat",
  pcm_mass_kg: "PCM mass",
  surface_area_m2: "Surface area",
  pcm_thickness_mm: "Thickness",
  mass_flow_rate_kgs: "Mass flow",
  cycle_number: "Cycle number",
  degradation_factor: "Degradation",
  temp_difference_c: "Temp difference",
  phase_fraction: "Phase fraction",
  heat_transfer_coeff_wm2k: "HTC",
  heat_flux_wm2: "Heat flux",
  stored_energy_kj: "Stored energy",
  energy_input_kj: "Energy input",
  charging_time_min: "Charge time",
  discharging_time_min: "Discharge time",
  energy_loss_pct: "Energy loss",
  state_of_charge_pct: "SOC",
  cooling_load_offset_pct: "Load offset",
  thermal_storage_efficiency_pct: "Efficiency",
};
