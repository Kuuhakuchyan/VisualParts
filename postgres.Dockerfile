# pgvector 镜像 + PostGIS + TimescaleDB
FROM pgvector/pgvector:pg16

# 中科大 USTC 源加速
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.ustc.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources \
    && sed -i 's|http://security.debian.org/debian-security|http://mirrors.ustc.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources

# 安装 PostGIS
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*

# 安装 TimescaleDB (需要 ca-certificates 解决 curl 证书问题)
RUN apt-get update && apt-get install -y --no-install-recommends gnupg curl ca-certificates \
    && update-ca-certificates \
    && curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian/ bookworm main" > /etc/apt/sources.list.d/timescaledb.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends timescaledb-2-postgresql-16 \
    && apt-get purge -y gnupg curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 关键: 将 timescaledb 加入 shared_preload_libraries
# Docker postgres 启动时会将 sample 配置复制为实际配置
RUN echo "shared_preload_libraries = 'timescaledb'" >> /usr/share/postgresql/postgresql.conf.sample
