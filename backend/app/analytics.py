import csv
from functools import lru_cache
from pathlib import Path
from statistics import mean


CATEGORY_COLUMNS = ("pcm_type", "system_type", "encapsulation_type")
NUMERIC_COLUMNS = [
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
]

MODEL_INPUTS = [
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
]

TARGETS = [
    "degradation_factor",
    "phase_fraction",
    "state_of_charge_pct",
    "stored_energy_kj",
    "energy_loss_pct",
    "thermal_storage_efficiency_pct",
]


@lru_cache(maxsize=4)
def load_rows(path: str) -> list[dict]:
    rows: list[dict] = []
    with Path(path).open(newline="") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            row = dict(raw)
            for column in NUMERIC_COLUMNS:
                row[column] = float(row[column])
            rows.append(row)
    return rows


def summarize(rows: list[dict]) -> dict:
    return {
        "rows": len(rows),
        "start": rows[0]["timestamp"] if rows else None,
        "end": rows[-1]["timestamp"] if rows else None,
        "mean_efficiency_pct": safe_mean(rows, "thermal_storage_efficiency_pct"),
        "mean_stored_energy_kj": safe_mean(rows, "stored_energy_kj"),
        "mean_soc_pct": safe_mean(rows, "state_of_charge_pct"),
        "mean_energy_loss_pct": safe_mean(rows, "energy_loss_pct"),
        "efficiency_cap_98_pct": pct(rows, lambda row: row["thermal_storage_efficiency_pct"] == 98),
        "efficiency_floor_35_pct": pct(rows, lambda row: row["thermal_storage_efficiency_pct"] == 35),
    }


def predict(rows: list[dict], scenario: dict, limit: int = 220, evidence_limit: int = 6) -> dict:
    missing = [column for column in (*CATEGORY_COLUMNS, *MODEL_INPUTS) if column not in scenario]
    if missing:
        raise ValueError(f"Scenario is missing required fields: {', '.join(missing)}")

    category_rows = [
        row
        for row in rows
        if row["pcm_type"] == scenario["pcm_type"]
        and row["system_type"] == scenario["system_type"]
        and row["encapsulation_type"] == scenario["encapsulation_type"]
    ]
    pool = category_rows if len(category_rows) >= 80 else rows
    ranges = {
        column: (min(row[column] for row in rows), max(row[column] for row in rows))
        for column in MODEL_INPUTS
    }
    nearest = sorted(
        ((row, distance(row, scenario, ranges)) for row in pool),
        key=lambda item: item[1],
    )[:limit]
    weights = [1 / (distance_value + 0.025) for _, distance_value in nearest]
    weight_sum = sum(weights)
    prediction = {
        target: sum(row[target] * weight for (row, _), weight in zip(nearest, weights)) / weight_sum
        for target in TARGETS
    }
    intervals = {
        target: {
            "p10": quantile([row[target] for row, _ in nearest], 0.10),
            "p50": quantile([row[target] for row, _ in nearest], 0.50),
            "p90": quantile([row[target] for row, _ in nearest], 0.90),
        }
        for target in TARGETS
    }
    evidence = [
        {
            "timestamp": row["timestamp"],
            "pcm_type": row["pcm_type"],
            "system_type": row["system_type"],
            "encapsulation_type": row["encapsulation_type"],
            "distance": round(distance_value, 6),
            "weight": round(weight / weight_sum, 8),
            "stored_energy_kj": row["stored_energy_kj"],
            "state_of_charge_pct": row["state_of_charge_pct"],
            "thermal_storage_efficiency_pct": row["thermal_storage_efficiency_pct"],
        }
        for (row, distance_value), weight in zip(nearest[:evidence_limit], weights[:evidence_limit])
    ]
    nearest_distance = nearest[0][1] if nearest else float("inf")
    return {
        "model": "evidence-grounded-similarity-estimator",
        "model_version": "0.4.0",
        "prediction": prediction,
        "intervals": intervals,
        "data_support_score": max(0.0, min(100.0, 100.0 - nearest_distance * 28)),
        "sample_size": len(nearest),
        "matching_category_rows": len(category_rows),
        "fallback_used": len(category_rows) < 80,
        "nearest_evidence": evidence,
    }


def distance(row: dict, scenario: dict, ranges: dict) -> float:
    total = 0.0
    for column in MODEL_INPUTS:
        low, high = ranges[column]
        span = max(high - low, 1e-9)
        total += abs((row[column] - float(scenario[column])) / span)
    return total


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def safe_mean(rows: list[dict], column: str) -> float:
    return mean(row[column] for row in rows) if rows else 0.0


def pct(rows: list[dict], predicate) -> float:
    return (sum(1 for row in rows if predicate(row)) / len(rows) * 100) if rows else 0.0
