FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV USE_MOCK_AGI=1
ENV PIP_INDEX_URL=https://pypi.org/simple
ENV DECISION_STATE_DB=/app/state/microclimate_decision.sqlite3
ENV WORKSPACE_STATE_DB=/app/state/plans.sqlite3
ENV AIC_STATE_DB=/app/state/evidence.sqlite3
ENV TELEMETRY_STATE_DB=/app/state/mobile-telemetry.sqlite3
ENV TELEMETRY_MEDIA_DIR=/app/state/telemetry-media
ENV DECISION_ENABLE_LEGACY_MOCK=0
ENV WEB_CONCURRENCY=2

WORKDIR /app

COPY backend/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock
RUN mkdir -p /app/state

COPY backend /app/backend
COPY release-version.json runtime-assets.json /app/
COPY models/*.json /app/models/
COPY public/data/*.geojson /app/public/data/
COPY public/data/reference-station.json /app/public/data/reference-station.json
RUN python -m backend.release_check

EXPOSE 3100
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port 3100 --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*'"]
