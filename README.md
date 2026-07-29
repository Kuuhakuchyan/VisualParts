# Weather Platform

Microclimate IoT data platform for weather.nogamenolife.cn.

This branch contains Docker Compose services for MQTT ingestion, PostgreSQL/PostGIS/TimescaleDB storage, the FastAPI dashboard, Grafana provisioning, and Nginx deployment config.

Do not commit runtime secrets or generated data volumes. Fill `.env` from `.env.example` on the server.
