from pathlib import Path
from uuid import uuid4
from fastapi import UploadFile
from .settings import Settings


async def store_upload(file: UploadFile, settings: Settings) -> str:
    key = f"datasets/{uuid4()}-{file.filename}"

    if settings.s3_access_key_id and settings.s3_secret_access_key:
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
        )
        client.upload_fileobj(file.file, settings.s3_bucket, key)
        return key

    local_dir = Path("uploads")
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / key.replace("/", "_")
    content = await file.read()
    local_path.write_bytes(content)
    return str(local_path)
