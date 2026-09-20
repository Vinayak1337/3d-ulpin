FROM python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ml.txt
# Rasterio's manylinux ARM wheel links this small XML runtime library.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY ml-models.json ./ml-models.json
COPY geo ./geo
RUN useradd --create-home --uid 10001 processor
USER processor
EXPOSE 8000
CMD ["uvicorn", "geo.api:app", "--host", "0.0.0.0", "--port", "8000"]
