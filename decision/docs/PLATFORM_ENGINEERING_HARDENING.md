# 微境探界平台工程加固方案

## 当前路由关系

- `/`：个人主页与项目总入口，使用 Kuuhakuchyan 身份展示。
- `/weather/` 或首页监测模块：实时气象、趋势图、设备状态与 Grafana 入口。
- `/decision/`：默认轻量 GIS 决策底座，使用 MapLibre 承载底图、真实 OSM 建筑轮廓白模、热场、传感器树和追踪图层。
- `/decision/?mode=3d`：Cesium 高级三维模式，仅在需要 3D Tiles、三维量测、地形或高精度三维分析时按需加载。
- `/grafana/`：运维监测仪表。

## 高并发策略

- 前端静态资产全部由 Vite 生成 hash 文件，适合配置 `Cache-Control: public, max-age=31536000, immutable`。
- 默认决策页只加载轻量入口和 MapLibre 独立块，Cesium 4MB 级高级三维块只在 `?mode=3d` 时加载，降低普通访问峰值带宽。
- 地图瓦片默认使用线上 `/tiles/world-imagery/...` 同源代理，便于 Nginx 缓存、限速和后续替换为自建瓦片服务；本地预览自动走 ArcGIS 原始瓦片。
- API 层建议按读多写少拆分缓存：实时天气当前值进 Redis，历史曲线分页查询，场景推演结果按 `scenarioId` 缓存。
- 传感器写入不直接压数据库主表，采用 MQTT broker -> ingestion service -> queue/buffer -> database 的削峰链路。
- 对 `/api/weather/current`、`/api/tracking/positions` 这类高频接口设置短 TTL 缓存和限流；对推演、导出、上传类接口单独设置更严格的并发上限。

## 安全与反逆向

- 前端不可存放任何真实密码、token、数据库连接串、MQTT 凭据；所有密钥必须只存在服务器环境变量或 Docker secret。
- `sourcemap` 保持关闭，构建产物分块和压缩只作为降低阅读成本的辅助手段，不把前端混淆当成核心安全边界。
- 重要能力必须由后端鉴权：导出报告、场景写入、设备管理、Grafana 管理、MQTT 管理都不能只靠前端隐藏按钮。
- API 需要统一鉴权、CSRF/Origin 检查、请求体大小限制、上传文件类型白名单、响应脱敏和审计日志。
- Cesium 依赖链构建时会出现第三方 `protobufjs` 的 eval 警告；默认模式不加载该块，高级三维模式后续应配合更细的 CSP 白名单单独评估。

## MQTT 暴露面

- Broker 不应直接暴露公网匿名连接。
- 每类设备使用独立账号、ACL topic，例如 `campus/{gatewayId}/sensor/{sensorId}/telemetry`。
- 生产环境优先启用 TLS/mTLS；至少启用强密码、IP 白名单、连接速率限制和保活超时。
- 浏览器端不直接连接管理 topic；如需 WebSocket MQTT，只开放只读或受限 topic，并通过后端签发短期 token。

## 可靠性与观测

- 前端已对轻量模式追踪轮询做失败降频，后端异常时从 3 秒刷新降至 15 秒，避免故障时继续放大压力。
- Cesium 高级模式增加渲染异常降级处理，避免单个影像解码问题直接中断整个三维场景。
- 服务端需要保留 request id、访问日志、错误日志、慢请求日志和推演任务日志，并在 Grafana 中按 RED/USE 指标展示。
- 数据库每日自动备份，至少保留 7/30/90 天三个粒度；关键配置、Nginx、Docker compose、Grafana dashboard JSON 纳入版本管理。
- 白模数据当前来源为 OpenStreetMap/ODbL，是真实公开建筑轮廓，不是学校官方测绘级模型；展示处必须持续保留来源标注。

## 下一步优先级

1. 将 `/tiles/world-imagery` 代理加上 Nginx 磁盘缓存和防盗刷限速。
2. 将传感器树改为后端接口驱动，当前页面内置节点只作为演示数据。
3. 给场景推演接口接入任务队列，长耗时计算返回 task id，由前端轮询或 SSE/WebSocket 获取结果。
4. 建立 OpenTelemetry 或至少 request id 串联日志，Grafana 增加 API 延迟、错误率、MQTT 连接数和数据库连接池面板。
