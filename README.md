# Weather Platform

Microclimate IoT data platform for weather.nogamenolife.cn.

This branch contains Docker Compose services for MQTT ingestion, PostgreSQL/PostGIS/TimescaleDB storage, the FastAPI dashboard, the public project homepage, Grafana provisioning, and Nginx deployment config.

The public homepage is served at `/`. Use `/monitor` to enter the real-time observation workspace, `/decision/` for spatial decision support, and `/sensors` or `/logs` for platform maintenance.

Do not commit runtime secrets or generated data volumes. Fill `.env` from `.env.example` on the server.

## V1.0 engineering candidate

The current decision platform also includes LCZ scenarios, building-change calculations,
regional population analysis, route simulations and project-only UGV/UAV telemetry.
Simulation fixtures are included; production telemetry, database volumes and API keys are not.

See [release checks and packaging](decision/docs/releases/V1.0工程收口.md) and
[current copyright preparation](decision/docs/copyright-v1/README.md).
The older `decision/docs/manual_*` documents describe a different historical project;
they are not application materials for this release.

From `decision/`, install Python 3.12 dependencies with
`python -m pip install --require-hashes -r requirements-test.lock`, run `npm ci`, then
`python scripts/verify-release.py`. The test ledger is saved under
`decision/output/release-check/`. This command does not deploy to production.
