import os

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
GEO_SERVICE_TOKEN = os.getenv("GEO_SERVICE_TOKEN", "")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", os.getenv("S3_ENDPOINT_URL", "http://minio:9000"))
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", os.getenv("S3_ACCESS_KEY_ID", ""))
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", os.getenv("S3_SECRET_ACCESS_KEY", ""))
S3_BUCKET = os.getenv("S3_BUCKET", "ulpin")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
