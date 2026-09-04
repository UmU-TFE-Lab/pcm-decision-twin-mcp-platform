FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/app /app/app
COPY pcm_thermal_storage.csv /pcm_thermal_storage.csv

ENV LOCAL_DATASET_PATH=/pcm_thermal_storage.csv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
