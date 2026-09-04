import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backend.app.analytics import MODEL_INPUTS, TARGETS, load_rows, predict


DATASET_VERSION = "pcm-thermal-storage-v1.0.0"
MODEL_VERSION = "similarity-estimator-v0.4.0"
DATASET_PATH = os.getenv("LOCAL_DATASET_PATH", "pcm_thermal_storage.csv")


class PredictRequest(BaseModel):
    scenario: dict
    limit: int = Field(default=220, ge=20, le=1000)
    evidence_limit: int = Field(default=6, ge=1, le=20)


app = FastAPI(title="PCM Model Service", version="0.2.0")


@app.get("/health")
def health() -> dict:
    rows = load_rows(DATASET_PATH)
    return {
        "status": "ok",
        "service": "pcm-model-service",
        "model": MODEL_VERSION,
        "dataset": DATASET_VERSION,
        "dataset_rows": len(rows),
    }


@app.get("/metadata")
def metadata() -> dict:
    return {
        "model": "evidence-grounded-similarity-estimator",
        "model_version": MODEL_VERSION,
        "dataset_version": DATASET_VERSION,
        "inputs": MODEL_INPUTS,
        "targets": TARGETS,
        "distance": "normalized L1",
        "weighting": "inverse distance with epsilon=0.025",
        "default_neighbors": 220,
    }


@app.post("/predict")
def predict_state(payload: PredictRequest) -> dict:
    try:
        result = predict(
            load_rows(DATASET_PATH),
            payload.scenario,
            limit=payload.limit,
            evidence_limit=payload.evidence_limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "dataset_version": DATASET_VERSION,
        "scenario": payload.scenario,
        **result,
    }
