-- ========== 扩展 ==========
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- ========== 设备表 ==========
CREATE TABLE device_info (
    device_id   VARCHAR(32) PRIMARY KEY,
    device_type VARCHAR(32),
    created_at  TIMESTAMPTZ DEFAULT now(),
    last_seen   TIMESTAMPTZ,
    firmware    VARCHAR(32)
);

-- ========== 时序数据 (TimescaleDB 超表) ==========
CREATE TABLE sensor_data (
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id  VARCHAR(32) NOT NULL REFERENCES device_info(device_id),
    bat_v      REAL,
    uptime_s   INTEGER,
    temp_c     REAL,
    humidity   REAL,
    extra      JSONB
);

SELECT create_hypertable('sensor_data', 'ts',
    chunk_time_interval => INTERVAL '1 day');

ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('sensor_data', INTERVAL '3 days');
SELECT add_retention_policy('sensor_data', INTERVAL '90 days');

CREATE INDEX idx_sensor_device_ts ON sensor_data (device_id, ts DESC);
CREATE INDEX idx_sensor_extra ON sensor_data USING GIN (extra jsonb_path_ops);

-- ========== GPS 位置 (PostGIS) ==========
CREATE TABLE device_location (
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id  VARCHAR(32) NOT NULL REFERENCES device_info(device_id),
    geom       GEOMETRY(Point, 4326),
    alt_m      REAL,
    satellites SMALLINT,
    pos_src    VARCHAR(16),
    accuracy_m REAL
);

CREATE INDEX idx_location_geom ON device_location USING GIST (geom);
CREATE INDEX idx_location_device_ts ON device_location (device_id, ts DESC);

SELECT create_hypertable('device_location', 'ts',
    chunk_time_interval => INTERVAL '1 day');

-- ========== 传感器字段元数据 ==========
CREATE TABLE sensor_fields (
    device_type  VARCHAR(32) NOT NULL,
    field_name   VARCHAR(32) NOT NULL,
    field_unit   VARCHAR(16),
    display_name VARCHAR(64),
    PRIMARY KEY (device_type, field_name)
);

INSERT INTO sensor_fields VALUES
    ('ATOM_LITE', 'temp_c',     '°C',   '温度'),
    ('ATOM_LITE', 'humidity',   '%',    '湿度'),
    ('ATOM_LITE', 'bat_v',      'V',    '电池电压'),
    ('ATOM_LITE', 'uptime_s',   's',    '运行时长'),
    ('ATOM_LITE', 'lat',        '°',    '纬度'),
    ('ATOM_LITE', 'lon',        '°',    '经度'),
    ('ATOM_LITE', 'alt_m',      'm',    '海拔'),
    ('ATOM_LITE', 'satellites', '颗',   '卫星数');

INSERT INTO sensor_fields VALUES
    ('M5Stick_Plus2', 'temp_c',   '°C',   '温度'),
    ('M5Stick_Plus2', 'humidity', '%',    '湿度'),
    ('M5Stick_Plus2', 'bat_v',    'V',    '电池电压'),
    ('M5Stick_Plus2', 'accel_x',  'm/s²', '加速度X'),
    ('M5Stick_Plus2', 'accel_y',  'm/s²', '加速度Y'),
    ('M5Stick_Plus2', 'accel_z',  'm/s²', '加速度Z'),
    ('M5Stick_Plus2', 'gyro_x',   '°/s',  '角速度X'),
    ('M5Stick_Plus2', 'gyro_y',   '°/s',  '角速度Y'),
    ('M5Stick_Plus2', 'gyro_z',   '°/s',  '角速度Z');

-- ========== RAG 知识库 (pgvector, 后续扩展) ==========
CREATE TABLE knowledge_embeddings (
    id         SERIAL PRIMARY KEY,
    source     VARCHAR(128),
    chunk_text TEXT,
    embedding  VECTOR(1536),
    metadata   JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_knowledge_embedding ON knowledge_embeddings
    USING ivfflat (embedding vector_cosine_ops);
