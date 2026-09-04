import hashlib
import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .analytics import MODEL_INPUTS, load_rows, predict, summarize
from .database import (
    Dataset,
    DatasetVersion,
    MCPLog,
    ModelVersion,
    PredictionRecord,
    Project,
    ReportRecord,
    ScenarioRecord,
    SessionLocal,
    get_db,
    init_db,
)
from .security import create_token, require_user
from .settings import Settings, get_settings
from .storage import store_upload


DATASET_VERSION = "pcm-thermal-storage-v1.0.0"
DATASET_SHA256 = "b3f7b665ead48f41ec58c12883ba80f341d27495925977885e20486d76f23db8"
MODEL_VERSION = "similarity-estimator-v0.4.0"


class LoginRequest(BaseModel):
    email: str
    password: str


class Scenario(BaseModel):
    pcm_type: str
    system_type: str
    encapsulation_type: str
    air_temperature_c: float
    relative_humidity_pct: float
    wind_speed_mps: float
    cloud_cover_pct: float
    solar_irradiance_wm2: float
    inlet_fluid_temp_c: float
    melting_point_c: float
    latent_heat_kjkg: float
    thermal_conductivity_wmk: float
    density_kgm3: float
    specific_heat_jkgk: float
    pcm_mass_kg: float
    surface_area_m2: float
    pcm_thickness_mm: float
    mass_flow_rate_kgs: float
    cycle_number: float


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=4000)


class ScenarioCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=255)
    scenario: Scenario


class ReportCreate(BaseModel):
    scenario_id: int
    prediction_id: int | None = None
    content: dict | None = None


class MCPLogCreate(BaseModel):
    project_id: int | None = None
    scenario_id: int | None = None
    run_id: str = Field(min_length=1, max_length=80)
    tool_name: str = Field(min_length=1, max_length=160)
    arguments: dict = Field(default_factory=dict)
    output_summary: dict = Field(default_factory=dict)
    status: str = Field(min_length=1, max_length=40)
    latency_ms: float | None = Field(default=None, ge=0)


@asynccontextmanager
async def lifespan(application: FastAPI):
    del application
    init_db()
    seed_release_versions()
    yield


app = FastAPI(title="PCM Decision-Twin API", version="0.2.0", lifespan=lifespan)
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def seed_release_versions() -> None:
    with SessionLocal() as db:
        if not db.query(DatasetVersion).filter(DatasetVersion.version == DATASET_VERSION).first():
            db.add(DatasetVersion(
                version=DATASET_VERSION,
                sha256=DATASET_SHA256,
                row_count=50_000,
                field_count=33,
                metadata_json={"release_mode": "frozen_canonical_csv"},
                created_by="system",
            ))
        if not db.query(ModelVersion).filter(ModelVersion.version == MODEL_VERSION).first():
            db.add(ModelVersion(
                name="Evidence-grounded similarity estimator",
                version=MODEL_VERSION,
                model_type="weighted-nearest-evidence",
                feature_schema={"inputs": MODEL_INPUTS},
                settings_json={"neighbors": 220, "distance": "normalized L1", "epsilon": 0.025},
                created_by="system",
            ))
        db.commit()


def require_owned_project(db: Session, project_id: int, user: str) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.owner != user:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_owned_scenario(db: Session, scenario_id: int, user: str) -> ScenarioRecord:
    scenario = db.get(ScenarioRecord, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    require_owned_project(db, scenario.project_id, user)
    return scenario


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": "0.2.0"}


@app.post(f"{settings.api_prefix}/auth/login")
def login(payload: LoginRequest, settings: Settings = Depends(get_settings)) -> dict:
    if payload.email != settings.admin_email or payload.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"access_token": create_token(payload.email, settings), "token_type": "bearer"}


@app.post(f"{settings.api_prefix}/datasets")
async def upload_dataset(
    file: UploadFile = File(...),
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    storage_key = await store_upload(file, settings)
    dataset = Dataset(filename=file.filename or "dataset.csv", storage_key=storage_key, created_by=user)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return {"id": dataset.id, "filename": dataset.filename, "storage_key": dataset.storage_key}


@app.get(f"{settings.api_prefix}/datasets")
def list_datasets(user: str = Depends(require_user), db: Session = Depends(get_db)) -> list[dict]:
    return [
        {
            "id": dataset.id,
            "filename": dataset.filename,
            "storage_key": dataset.storage_key,
            "status": dataset.status,
            "created_at": dataset.created_at.isoformat(),
        }
        for dataset in db.query(Dataset)
        .filter(Dataset.created_by == user)
        .order_by(Dataset.created_at.desc())
        .limit(50)
    ]


@app.get(f"{settings.api_prefix}/versions")
def list_versions(user: str = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    del user
    return {
        "datasets": [
            {"version": item.version, "sha256": item.sha256, "rows": item.row_count, "fields": item.field_count}
            for item in db.query(DatasetVersion).order_by(DatasetVersion.created_at.desc())
        ],
        "models": [
            {"name": item.name, "version": item.version, "type": item.model_type, "status": item.status}
            for item in db.query(ModelVersion).order_by(ModelVersion.created_at.desc())
        ],
    }


@app.get(f"{settings.api_prefix}/summary")
def dataset_summary(
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    del user
    return summarize(load_rows(settings.local_dataset_path))


@app.post(f"{settings.api_prefix}/twin/predict")
def twin_predict(
    scenario: Scenario,
    user: str = Depends(require_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    del user
    rows = load_rows(settings.local_dataset_path)
    return predict(rows, scenario.model_dump())


@app.post(f"{settings.api_prefix}/projects")
def create_project(
    payload: ProjectCreate,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    project = Project(name=payload.name, description=payload.description, owner=user)
    db.add(project)
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@app.get(f"{settings.api_prefix}/projects")
def list_projects(user: str = Depends(require_user), db: Session = Depends(get_db)) -> list[dict]:
    return [
        serialize_project(project)
        for project in db.query(Project)
        .filter(Project.owner == user)
        .order_by(Project.created_at.desc())
    ]


@app.post(f"{settings.api_prefix}/scenarios")
def create_scenario_run(
    payload: ScenarioCreate,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    require_owned_project(db, payload.project_id, user)
    inputs = payload.scenario.model_dump()
    result = predict(load_rows(settings.local_dataset_path), inputs)
    branch_status = "directly_supported" if inputs["system_type"] == "BuildingEnvelope" else "scenario_extension"
    validation = {
        "exact_category_records": result["matching_category_rows"],
        "fallback_used": result["fallback_used"],
        "branch_status": branch_status,
    }
    scenario = ScenarioRecord(
        project_id=payload.project_id,
        name=payload.name,
        inputs=inputs,
        validation=validation,
        dataset_version=DATASET_VERSION,
        model_version=MODEL_VERSION,
        created_by=user,
    )
    db.add(scenario)
    db.flush()
    prediction = PredictionRecord(
        scenario_id=scenario.id,
        output=result["prediction"] | {"intervals": result["intervals"]},
        evidence=result["nearest_evidence"],
        data_support_score=result["data_support_score"],
    )
    db.add(prediction)
    db.commit()
    db.refresh(scenario)
    db.refresh(prediction)
    return {
        "scenario": serialize_scenario(scenario),
        "prediction": serialize_prediction(prediction),
    }


@app.get(f"{settings.api_prefix}/scenarios")
def list_scenarios(
    project_id: int,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_owned_project(db, project_id, user)
    return [
        serialize_scenario(item)
        for item in db.query(ScenarioRecord)
        .filter(ScenarioRecord.project_id == project_id)
        .order_by(ScenarioRecord.created_at.desc())
    ]


@app.get(f"{settings.api_prefix}/scenarios/{{scenario_id}}")
def get_scenario(
    scenario_id: int,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    scenario = require_owned_scenario(db, scenario_id, user)
    predictions = db.query(PredictionRecord).filter(PredictionRecord.scenario_id == scenario.id).all()
    return {
        "scenario": serialize_scenario(scenario),
        "predictions": [serialize_prediction(item) for item in predictions],
    }


@app.post(f"{settings.api_prefix}/reports")
def create_report(
    payload: ReportCreate,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    scenario = require_owned_scenario(db, payload.scenario_id, user)
    prediction = db.get(PredictionRecord, payload.prediction_id) if payload.prediction_id else None
    if prediction is not None and prediction.scenario_id != scenario.id:
        raise HTTPException(status_code=400, detail="Prediction does not belong to scenario")
    if prediction is None:
        prediction = (
            db.query(PredictionRecord)
            .filter(PredictionRecord.scenario_id == scenario.id)
            .order_by(PredictionRecord.created_at.desc())
            .first()
        )
    content = payload.content or {
        "scenario": serialize_scenario(scenario),
        "prediction": serialize_prediction(prediction) if prediction else None,
    }
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    report = ReportRecord(
        scenario_id=scenario.id,
        prediction_id=prediction.id if prediction else None,
        content=content,
        sha256=digest,
        created_by=user,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return serialize_report(report)


@app.get(f"{settings.api_prefix}/reports")
def list_reports(
    project_id: int,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_owned_project(db, project_id, user)
    scenario_ids = [
        item.id for item in db.query(ScenarioRecord.id).filter(ScenarioRecord.project_id == project_id)
    ]
    if not scenario_ids:
        return []
    return [
        serialize_report(item)
        for item in db.query(ReportRecord)
        .filter(ReportRecord.scenario_id.in_(scenario_ids))
        .order_by(ReportRecord.created_at.desc())
    ]


@app.post(f"{settings.api_prefix}/mcp-logs")
def create_mcp_log(
    payload: MCPLogCreate,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.project_id is not None:
        require_owned_project(db, payload.project_id, user)
    if payload.scenario_id is not None:
        require_owned_scenario(db, payload.scenario_id, user)
    item = MCPLog(**payload.model_dump(), created_by=user)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "run_id": item.run_id, "tool_name": item.tool_name, "status": item.status}


@app.get(f"{settings.api_prefix}/mcp-logs")
def list_mcp_logs(
    project_id: int,
    user: str = Depends(require_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_owned_project(db, project_id, user)
    return [
        {
            "id": item.id,
            "run_id": item.run_id,
            "tool_name": item.tool_name,
            "status": item.status,
            "latency_ms": item.latency_ms,
            "created_at": item.created_at.isoformat(),
        }
        for item in db.query(MCPLog)
        .filter(MCPLog.project_id == project_id)
        .order_by(MCPLog.created_at.desc())
        .limit(500)
    ]


def serialize_project(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "owner": project.owner,
        "created_at": project.created_at.isoformat(),
    }


def serialize_scenario(scenario: ScenarioRecord) -> dict:
    return {
        "id": scenario.id,
        "project_id": scenario.project_id,
        "name": scenario.name,
        "inputs": scenario.inputs,
        "validation": scenario.validation,
        "dataset_version": scenario.dataset_version,
        "model_version": scenario.model_version,
        "created_at": scenario.created_at.isoformat(),
    }


def serialize_prediction(prediction: PredictionRecord) -> dict:
    return {
        "id": prediction.id,
        "scenario_id": prediction.scenario_id,
        "output": prediction.output,
        "evidence": prediction.evidence,
        "data_support_score": prediction.data_support_score,
        "created_at": prediction.created_at.isoformat(),
    }


def serialize_report(report: ReportRecord) -> dict:
    return {
        "id": report.id,
        "scenario_id": report.scenario_id,
        "prediction_id": report.prediction_id,
        "sha256": report.sha256,
        "content": report.content,
        "created_at": report.created_at.isoformat(),
    }
