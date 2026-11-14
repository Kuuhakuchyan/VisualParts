"""CI-only PostgreSQL extension/schema roundtrip in a disposable Docker container."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="wjtj-pg-recovery")
    parser.add_argument("--output", type=Path, default=ROOT / "output/postgres-recovery")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    container = "wjtj-recovery-" + str(os.getpid())
    checks = []
    def run(*command, **kwargs):
        return subprocess.check_output(command, **kwargs)
    def sql(database, statement):
        return run("docker", "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-U", "postgres", "-d", database, "-c", statement).decode().strip()
    try:
        run("docker", "run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=ephemeral-ci-fixture-only", args.image)
        for attempt in range(45):
            if subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable PostgreSQL did not start")
        sql("postgres", "CREATE DATABASE source_fixture")
        schema = (ROOT / "pg_init/001_init.sql").read_bytes()
        run("docker", "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "source_fixture", input=schema)
        sql("source_fixture", "INSERT INTO device_info(device_id,device_type) VALUES('SYNTHETIC','ATOM_LITE'); INSERT INTO sensor_data(ts,device_id,temp_c,humidity,extra) VALUES('2026-11-15T00:00:00Z','SYNTHETIC',31.25,62.5,'{\"test_fixture\":true}'); INSERT INTO device_location(ts,device_id,geom,alt_m) VALUES('2026-11-15T00:00:00Z','SYNTHETIC',ST_SetSRID(ST_MakePoint(113.532,34.814),4326),10); INSERT INTO knowledge_embeddings(source,chunk_text,metadata) VALUES('synthetic','recovery fixture','{\"test_fixture\":true}');")
        checks.append("actual platform schema with PostGIS, TimescaleDB and pgvector initializes")
        query = "SELECT json_build_object('devices',(SELECT json_agg(t) FROM (SELECT * FROM device_info ORDER BY device_id)t),'observations',(SELECT json_agg(t) FROM (SELECT * FROM sensor_data ORDER BY ts)t),'locations',(SELECT json_agg(t) FROM (SELECT device_id,ST_AsText(geom) AS geom,alt_m FROM device_location ORDER BY ts)t),'knowledge',(SELECT json_agg(t) FROM (SELECT * FROM knowledge_embeddings ORDER BY id)t),'fields',(SELECT json_agg(t) FROM (SELECT * FROM sensor_fields ORDER BY device_type,field_name)t));"
        before = json.loads(sql("source_fixture", query))
        with tempfile.TemporaryDirectory(prefix="wjtj-pg-dump-") as tmp:
            env = dict(os.environ, BACKUP_DIR=tmp, POSTGRES_CONTAINER=container, POSTGRES_DB="source_fixture", POSTGRES_USER="postgres")
            run("sh", str(ROOT / "scripts/backup_postgres.sh"), env=env)
            dumps = list(Path(tmp).glob("*.dump"))
            assert len(dumps) == 1
            checks.append("backup publishes one validated custom-format archive")
            sql("postgres", "CREATE DATABASE restored_fixture")
            sql("restored_fixture", "CREATE EXTENSION timescaledb; SELECT timescaledb_pre_restore();")
            run("docker", "exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "-U", "postgres", "-d", "restored_fixture", input=dumps[0].read_bytes())
            sql("restored_fixture", "SELECT timescaledb_post_restore();")
            assert json.loads(sql("restored_fixture", query)) == before
            checks.append("all application row values and geospatial geometry restored exactly")
            assert sql("restored_fixture", "SELECT count(*) FROM timescaledb_information.hypertables") == "2"
            checks.append("both time-series hypertables restored")
            extensions = sql("restored_fixture", "SELECT extname FROM pg_extension ORDER BY extname").splitlines()
            assert {"postgis", "timescaledb", "vector"} <= set(extensions)
            checks.append("required database extensions preserved")
            bad_env = dict(env, POSTGRES_DB="database_does_not_exist")
            failed = subprocess.run(["sh", str(ROOT / "scripts/backup_postgres.sh")], env=bad_env, capture_output=True)
            assert failed.returncode != 0 and len(list(Path(tmp).glob("*.dump"))) == 1 and not list(Path(tmp).glob(".*-??????"))
            checks.append("failed pg_dump returns failure and publishes no archive")
            result = {"status": "PASS", "test_fixture": True, "production_mutated": False, "passed": len(checks), "checks": checks,
                      "extensions": extensions, "dump_sha256": hashlib.sha256(dumps[0].read_bytes()).hexdigest()}
        (args.output / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print("PostgreSQL recovery: PASS")
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)


if __name__ == "__main__":
    main()
