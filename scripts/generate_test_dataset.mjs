import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SAMPLES_PER_CONFIGURATION = 240;
const PCM_TYPES = ["Organic_Paraffin", "Inorganic_SaltHydrate", "Eutectic"];
const SYSTEM_TYPES = ["BuildingEnvelope", "SolarTES", "BatteryCooling", "HVACStorage"];
const ENCAPSULATION_TYPES = ["Macro", "Micro", "ShapeStabilized"];

const COLUMNS = [
  "timestamp",
  "pcm_type",
  "system_type",
  "encapsulation_type",
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
  "degradation_factor",
  "temp_difference_c",
  "phase_fraction",
  "heat_transfer_coeff_wm2k",
  "heat_flux_wm2",
  "stored_energy_kj",
  "energy_input_kj",
  "charging_time_min",
  "discharging_time_min",
  "energy_loss_pct",
  "state_of_charge_pct",
  "cooling_load_offset_pct",
  "thermal_storage_efficiency_pct",
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const fract = (value) => value - Math.floor(value);
const rounded = (value) => Number(value.toFixed(6));

function timestamp(index) {
  const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0) + index * 3_600_000);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

const rows = [];
let rowIndex = 0;

for (let pcmIndex = 0; pcmIndex < PCM_TYPES.length; pcmIndex += 1) {
  for (let systemIndex = 0; systemIndex < SYSTEM_TYPES.length; systemIndex += 1) {
    for (let encapsulationIndex = 0; encapsulationIndex < ENCAPSULATION_TYPES.length; encapsulationIndex += 1) {
      const configurationIndex = pcmIndex * 12 + systemIndex * 3 + encapsulationIndex;
      for (let sample = 0; sample < SAMPLES_PER_CONFIGURATION; sample += 1) {
        const a = fract(sample * 0.037 + configurationIndex * 0.113);
        const b = fract(sample * 0.071 + configurationIndex * 0.173);
        const c = fract(sample * 0.109 + configurationIndex * 0.197);
        const d = fract(sample * 0.151 + configurationIndex * 0.223);
        const airTemperature = 5 + 35 * a;
        const humidity = 30 + 65 * b;
        const windSpeed = 0.1 + 11.5 * c;
        const cloudCover = 100 * d;
        const solarIrradiance = 900 * Math.max(0, Math.sin(Math.PI * fract(sample * 0.043 + systemIndex * 0.17)));
        const inletTemperature = 10 + 40 * fract(sample * 0.083 + configurationIndex * 0.061);
        const meltingBase = [26, 32, 40][pcmIndex];
        const meltingPoint = meltingBase + 4 * fract(sample * 0.029 + encapsulationIndex * 0.19);
        const latentHeat = 165 + 105 * fract(sample * 0.047 + pcmIndex * 0.21);
        const conductivity = 0.19 + 0.5 * fract(sample * 0.067 + pcmIndex * 0.13);
        const density = 780 + 860 * fract(sample * 0.053 + pcmIndex * 0.23);
        const specificHeat = 1450 + 1100 * fract(sample * 0.059 + pcmIndex * 0.29);
        const mass = 10 + 145 * fract(sample * 0.031 + systemIndex * 0.17);
        const area = 1.3 + 10 * fract(sample * 0.041 + systemIndex * 0.11);
        const thickness = 4 + 35 * fract(sample * 0.073 + encapsulationIndex * 0.17);
        const flowRate = 0.03 + 0.36 * fract(sample * 0.097 + systemIndex * 0.13);
        const cycleNumber = 1 + ((sample * 11 + configurationIndex * 47) % 2500);
        const degradation = clamp(1 - cycleNumber * 0.00006 + 0.004 * Math.sin(sample), 0.83, 1);
        const temperatureDifference = inletTemperature - meltingPoint;
        const phaseFraction = clamp((temperatureDifference + 8) / 20, 0, 1);
        const heatTransferCoefficient = 12 + 125 * flowRate + 2.5 * encapsulationIndex;
        const heatFlux = clamp(heatTransferCoefficient * temperatureDifference, -480, 480);
        const storedEnergy = mass * latentHeat * phaseFraction * degradation * 0.9;
        const efficiency = clamp(
          73 + 18 * phaseFraction - 0.12 * Math.abs(temperatureDifference) - 8 * (1 - degradation),
          35,
          98,
        );
        const energyInput = storedEnergy > 0 ? storedEnergy / (efficiency / 100) : 0;
        const energyLoss = clamp(100 - efficiency, 2, 35);
        const chargingTime = 18 + 170 * (1 - phaseFraction) + 20 * (1 - degradation);
        const dischargingTime = 18 + 150 * phaseFraction + 15 * (1 - degradation);
        const stateOfCharge = 100 * phaseFraction;
        const coolingOffset = clamp(8 + 62 * phaseFraction + 0.3 * (efficiency - 70), 0, 100);

        rows.push([
          timestamp(rowIndex),
          PCM_TYPES[pcmIndex],
          SYSTEM_TYPES[systemIndex],
          ENCAPSULATION_TYPES[encapsulationIndex],
          rounded(airTemperature),
          rounded(humidity),
          rounded(windSpeed),
          rounded(cloudCover),
          rounded(solarIrradiance),
          rounded(inletTemperature),
          rounded(meltingPoint),
          rounded(latentHeat),
          rounded(conductivity),
          rounded(density),
          rounded(specificHeat),
          rounded(mass),
          rounded(area),
          rounded(thickness),
          rounded(flowRate),
          cycleNumber,
          rounded(degradation),
          rounded(temperatureDifference),
          rounded(phaseFraction),
          rounded(heatTransferCoefficient),
          rounded(heatFlux),
          rounded(storedEnergy),
          rounded(energyInput),
          rounded(chargingTime),
          rounded(dischargingTime),
          rounded(energyLoss),
          rounded(stateOfCharge),
          rounded(coolingOffset),
          rounded(efficiency),
        ].join(","));
        rowIndex += 1;
      }
    }
  }
}

const csv = `${COLUMNS.join(",")}\n${rows.join("\n")}\n`;
const rootTarget = path.join(ROOT, "pcm_thermal_storage.csv");
const publicTarget = path.join(ROOT, "public", "pcm_thermal_storage.csv");
fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
fs.writeFileSync(rootTarget, csv);
fs.writeFileSync(publicTarget, csv);

process.stdout.write(
  `Generated ${rows.length} deterministic software-test rows. This fixture is not research data.\n`,
);
