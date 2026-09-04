import csv
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ["LOCAL_DATASET_PATH"] = str(ROOT / "pcm_thermal_storage.csv")

from fastapi.testclient import TestClient

from app.main import app


def scenario_from_csv() -> dict:
    with (ROOT / "pcm_thermal_storage.csv").open(newline="") as handle:
        row = next(csv.DictReader(handle))
    fields = [
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
    ]
    return {
        field: row[field] if field in {"pcm_type", "system_type", "encapsulation_type"} else float(row[field])
        for field in fields
    }


def test_model_service_returns_weighted_prediction_and_evidence() -> None:
    client = TestClient(app)
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["dataset_rows"] >= 220

    response = client.post(
        "/predict",
        json={"scenario": scenario_from_csv(), "limit": 220, "evidence_limit": 6},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["model"] == "evidence-grounded-similarity-estimator"
    assert result["sample_size"] == 220
    assert len(result["nearest_evidence"]) == 6
    assert result["prediction"]["thermal_storage_efficiency_pct"] <= 98


def test_model_service_rejects_incomplete_scenario() -> None:
    client = TestClient(app)
    response = client.post("/predict", json={"scenario": {"system_type": "BuildingEnvelope"}})
    assert response.status_code == 422
