import csv
import os
from pathlib import Path

DB_PATH = Path("/tmp/pcm-decision-twin-backend-test.db")
DB_PATH.unlink(missing_ok=True)
ROOT = Path(__file__).resolve().parents[2]
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
os.environ["LOCAL_DATASET_PATH"] = str(ROOT / "pcm_thermal_storage.csv")
os.environ["JWT_SECRET"] = "test-secret"
os.environ["ADMIN_EMAIL"] = "admin-test@example.com"
os.environ["ADMIN_PASSWORD"] = "test-password"

from fastapi.testclient import TestClient

from app.main import app


def scenario_from_csv() -> dict:
    with (ROOT / "pcm_thermal_storage.csv").open(newline="") as handle:
        row = next(csv.DictReader(handle))
    category_fields = {"pcm_type", "system_type", "encapsulation_type"}
    fields = {
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
    }
    return {field: row[field] if field in category_fields else float(row[field]) for field in fields}


def auth_headers(client: TestClient) -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin-test@example.com", "password": "test-password"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_persistent_project_scenario_report_and_mcp_log_lifecycle() -> None:
    with TestClient(app) as client:
        headers = auth_headers(client)
        versions = client.get("/api/v1/versions", headers=headers)
        assert versions.status_code == 200
        assert versions.json()["datasets"][0]["version"] == "pcm-thermal-storage-v1.0.0"

        project = client.post(
            "/api/v1/projects",
            headers=headers,
            json={"name": "Envelope review", "description": "API lifecycle test"},
        )
        assert project.status_code == 200
        project_id = project.json()["id"]

        run = client.post(
            "/api/v1/scenarios",
            headers=headers,
            json={"project_id": project_id, "name": "Baseline", "scenario": scenario_from_csv()},
        )
        assert run.status_code == 200, run.text
        run_payload = run.json()
        scenario_id = run_payload["scenario"]["id"]
        prediction_id = run_payload["prediction"]["id"]
        assert run_payload["prediction"]["evidence"]
        assert run_payload["prediction"]["output"]["stored_energy_kj"] >= 0

        report = client.post(
            "/api/v1/reports",
            headers=headers,
            json={"scenario_id": scenario_id, "prediction_id": prediction_id},
        )
        assert report.status_code == 200
        assert len(report.json()["sha256"]) == 64

        log = client.post(
            "/api/v1/mcp-logs",
            headers=headers,
            json={
                "project_id": project_id,
                "scenario_id": scenario_id,
                "run_id": "test-run-1",
                "tool_name": "explain_prediction",
                "arguments": {"scenario_id": scenario_id},
                "output_summary": {"evidence_records": 6},
                "status": "success",
                "latency_ms": 42.5,
            },
        )
        assert log.status_code == 200

        assert len(client.get(f"/api/v1/scenarios?project_id={project_id}", headers=headers).json()) == 1
        assert len(client.get(f"/api/v1/reports?project_id={project_id}", headers=headers).json()) == 1
        assert len(client.get(f"/api/v1/mcp-logs?project_id={project_id}", headers=headers).json()) == 1


def test_unauthenticated_lifecycle_access_is_rejected() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/projects")
        assert response.status_code == 401
