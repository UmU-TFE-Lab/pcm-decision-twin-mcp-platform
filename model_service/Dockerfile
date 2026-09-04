FROM python:3.12-slim

WORKDIR /app

COPY model_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY model_service/app /app/app
COPY backend/app/analytics.py /app/backend/app/analytics.py
COPY pcm_thermal_storage.csv /pcm_thermal_storage.csv

ENV LOCAL_DATASET_PATH=/pcm_thermal_storage.csv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
