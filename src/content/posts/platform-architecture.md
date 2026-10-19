---
title: 微气候平台的当前工程结构
published: 2026-07-29
updated: 2026-07-29
pinned: true
description: 当前平台由 MQTT 接入、数据桥接、PostgreSQL/PostGIS/TimescaleDB、FastAPI 和 Grafana 组成，已经具备轻量化线上运行能力。
tags: [IoT, FastAPI, PostgreSQL, Grafana, Docker]
category: 平台工程
image: ../../assets/images/spatial-decision.png
author: 微境探界项目团队
---

当前 `weather` 平台是一套轻量但可扩展的物联网数据系统。设备侧通过 MQTT 上报传感数据，桥接服务负责清洗并写入数据库，FastAPI 对外提供查询接口和基础页面，Grafana 用于指标看板展示。

配图为早期空间平台演示画面，其中部分观测指标使用模拟数据。

上线后的关键工程状态包括：

- **数据接入**：Mosquitto 提供 MQTT 接入，桥接服务订阅传感器主题并写入数据库。
- **空间数据底座**：PostgreSQL 配合 PostGIS、TimescaleDB 和 pgvector，为位置、时间序列和后续智能检索留出空间。
- **平台接口**：FastAPI 提供设备列表、最新数据、历史数据、轨迹和 CSV 导出等接口。
- **可视化**：Grafana 与内置仪表盘共同承担实时查看、历史追踪和调试展示。
- **上线安全**：公网入口统一收敛到 Nginx HTTPS，数据库、API、Grafana 和 WebSocket 管理端口已收回到服务器本机访问。

这套结构适合大创阶段快速迭代，也方便未来升级到更完整的前后端分离架构、队列系统、缓存层和统一认证体系。
