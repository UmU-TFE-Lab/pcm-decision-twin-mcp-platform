from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PCM Digital Twin API"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    database_url: str
    jwt_secret: str
    jwt_issuer: str = "pcm-digital-twin"
    access_token_minutes: int = 480

    admin_email: str = "admin@example.com"
    admin_password: str

    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str = "pcm-datasets"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    model_service_url: str = "http://model-service:9000"
    local_dataset_path: str = "../pcm_thermal_storage.csv"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
