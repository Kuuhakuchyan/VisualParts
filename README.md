# Weather Platform

Microclimate IoT data platform for weather.nogamenolife.cn.

This branch contains Docker Compose services for MQTT ingestion, PostgreSQL/PostGIS/TimescaleDB storage, the FastAPI dashboard, the public project homepage, Grafana provisioning, and Nginx deployment config.

The public homepage is served at `/`. Use `/monitor` to enter the real-time observation workspace, `/decision/` for spatial decision support, and `/sensors` or `/logs` for platform maintenance.

Do not commit runtime secrets or generated data volumes. Fill `.env` from `.env.example` on the server.
