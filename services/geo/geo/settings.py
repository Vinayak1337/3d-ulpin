import os
import tempfile
from pathlib import Path

VERIFIED_CACHE_DIR = os.getenv("VERIFIED_CACHE_DIR", str(Path(tempfile.gettempdir()) / "ulpin-verified-originals"))
VERIFIED_CACHE_BYTES = int(os.getenv("VERIFIED_CACHE_BYTES", str(8 * 1024 ** 3)))
VERIFIED_CACHE_FREE_BYTES = int(os.getenv("VERIFIED_CACHE_FREE_BYTES", str(2 * 1024 ** 3)))

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
GEO_SERVICE_TOKEN = os.getenv("GEO_SERVICE_TOKEN", "")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", os.getenv("S3_ENDPOINT_URL", "http://minio:9000"))
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", os.getenv("S3_ACCESS_KEY_ID", ""))
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", os.getenv("S3_SECRET_ACCESS_KEY", ""))
S3_BUCKET = os.getenv("S3_BUCKET", "ulpin")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
