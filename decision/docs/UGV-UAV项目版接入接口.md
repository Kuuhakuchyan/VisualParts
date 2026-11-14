# UGV / UAV 项目版采集接口

版本：`WJTJ-mobile-telemetry-1.0`。适用项目版，竞赛版不注册这套路由；竞赛 Nginx 同时阻断整个路径。已于2026-11-06完成公网回读验收：31项通过，并从本机复查有效凭证200、无效凭证401与AIC写入404。此项仅验证软件接入，不代表真实车辆已经开始上传或实测已进入热场。

## 1. 服务配置与鉴权

所有地址以项目版域名为前缀：`https://weather.nogamenolife.cn`。本地联调使用后端实际监听地址。所有上传、查询、图片和 schema 请求均需要请求头：

```http
X-Telemetry-Token: <服务端配置的接入凭证>
```

不要把凭证写入前端代码、JSON样例或 Git。当前采用一个项目服务凭证，持有者可以访问该项目所有移动设备；尚未实现每台设备独立密钥或细粒度角色权限。

服务端环境变量：

| 配置 | 用途 |
| --- | --- |
| `MOBILE_TELEMETRY_ENABLED=1` | 项目版启用接口 |
| `TELEMETRY_INGEST_TOKEN` | 必须设置的私密接入凭证；未配置返回503，不允许匿名写入 |
| `TELEMETRY_STATE_DB` | SQLite观测台账路径；Compose默认`/app/state/mobile-telemetry.sqlite3` |
| `TELEMETRY_MEDIA_DIR` | 图片目录；Compose默认`/app/state/telemetry-media` |
| `DECISION_MAX_REQUEST_BYTES` | JSON请求总大小；默认262144字节 |

独立 systemd 项目版需将台账、图片目录设置到持久化目录，并安装更新后的后端依赖；不应依赖临时目录保存正式采集。Compose 已将上述两项放入持久卷。竞赛配置为 `MOBILE_TELEMETRY_ENABLED=0`；既有 `COLLECTION_IOT_DISABLED=1` 也会禁用真实移动接入。

当前项目版公网配置使用`/etc/microclimate-project-telemetry.env`，systemd通过独立drop-in加载；台账与媒体分别在`/root/microclimate-decision/state/mobile-telemetry.sqlite3`和`/root/microclimate-decision/state/telemetry-media`。无凭证应返回401，不能再将本次路由当作尚未部署。

设备端配置已私密保存到`G:\Working\大创\output\project-telemetry-20261106\private\telemetry.env`，内含`TELEMETRY_BASE_URL`与`TELEMETRY_INGEST_TOKEN`，不纳入Git或竞赛材料。对接既有采集端时，应将这两项映射到其配置，令每次请求携带`X-Telemetry-Token`；不要在截图、日志或聊天中展开凭证。该文件的本地访问权限仅授予当前用户和SYSTEM。

## 2. 接口清单

统一前缀：`/api/weather/telemetry`。

| 方法 | 后续路径 | 功能 |
| --- | --- | --- |
| GET | `/capabilities` | 版本、大小限制和功能边界 |
| GET | `/schema` | 完整 JSON Schema：统一观测、状态、GPS与旧UGV格式 |
| POST | `/ugv` | UGV单条采集入库，兼容原IF-02双层报文 |
| POST | `/uav` | UAV单条采集入库 |
| POST | `/ugv/batch` | UGV批量补传 |
| POST | `/uav/batch` | UAV批量补传 |
| POST | `/status` | 独立设备状态、心跳和电池信息 |
| POST | `/gps` | 独立位置采样 |
| GET | `/devices` | 聚合设备状态，按各部分采样时间合并，包含`component_times` |
| GET | `/devices/{device_id}/latest` | 最新完整环境观测，保持原观测结构，不把新心跳冒充新温湿度 |
| GET | `/devices/{device_id}/status` | 最新状态，比较完整观测与独立心跳的采样时间 |
| GET | `/devices/{device_id}/location` | 最新位置，比较完整观测与独立GPS的采样时间 |
| GET | `/devices/{device_id}/observations?limit=100` | 最近环境观测，倒序，limit为1至1000 |
| GET | `/devices/{device_id}/track?limit=100` | 定位点GeoJSON，时间升序，不补画未采样的连续路线 |
| GET | `/observations/{uuid}` | 按UUID回读完整环境观测 |
| PUT | `/media/{sha256}` | 单张图片原始字节上传 |
| GET | `/media/{sha256}` | 鉴权后读取已上传图片 |

## 3. 字段与单位

精确的必填项、枚举和限制以 `/schema` 为准；未知字段会被拒绝。

| 分组 | 字段 | 用途 |
| --- | --- | --- |
| 标识 | `schema_version`, `uuid`, `device_type`, `device_name`, `device_id` | UUID v4、UGV/UAV、设备展示名称与稳定ID |
| 任务 | `task_id`, `task_group_id`, `seq` | 采集任务、协同批次、非负整数序号 |
| 时间 | `sampled_at_ms` | 真正采样时间，必须含时区，最大毫秒精度；入库统一UTC |
| 来源 | `source_type` | 固定为`field_collection`；采集仿真不能从此入口混入 |
| 状态 | `status.state`, `mode`, `error_code`, `selftest_pass`, `is_synced`, `unsynced_count` | 设备状态、工作模式、错误、自检、时钟同步与积压量 |
| 通信与版本 | `network_type`, `rssi_dbm`, `firmware_version`, `config_version`, `software_commit`, `interface_version`, `uptime_s` | 均位于`status`内 |
| 定位 | `location.latitude`, `longitude`, `altitude_m`, `altitude_reference`, `crs` | WGS84/EPSG:4326；必须转换GCJ-02后再上传；UAV必须提供高程 |
| 定位质量 | `accuracy_m`, `fix_type`, `satellites`, `hdop`, `heading_deg`, `speed_mps` | 位于`location`；UGV速度上限1.5m/s |
| 环境 | `measurements.temperature_c`, `humidity_pct` | 气温°C、相对湿度%RH；必填，可用null明确表示传感器无读数 |
| 环境扩展 | `pressure_hpa`, `wind_speed_mps`, `wind_direction_deg`, `solar_radiation_w_m2`, `globe_temperature_c` | 可选；缺少的传感器不要填0冒充测量 |
| 原始值与高度 | `temperature_raw_c`, `temperature_secondary_c`, `humidity_raw_pct`, `sensor_height_agl_m` | 位于`measurements`；记录原始读数、备用温度、载荷离地高度 |
| 电源 | `power.voltage_v`, `current_a`, `power_w`, `soc_pct`, `charging` | 电压、电流、功率、电量、充电状态 |
| UGV载荷 | `ugv.fan_rpm`, `body_temperature_c`, `odometer_m`, `emergency_stop` | 通风、机体温度、里程与急停 |
| UAV飞行 | `uav.altitude_agl_m`, `flight_mode`, `armed`, `roll_deg`, `pitch_deg`, `yaw_deg`, `vertical_speed_mps`, `gimbal_pitch_deg`, `distance_to_home_m` | 相对地面高度、飞行模式、姿态与返航距离 |
| 质量追溯 | `quality_flag`, `sensor_id`, `calibration_id`, `lcz_hint` | uint32质量位、传感器与标定记录编号、LCZ类别 |
| 视觉图像 | `visual_frames[]` | 图片ID、拍摄时刻、相机、模态、文件引用、SHA-256、类型、大小、分辨率和拍摄位置 |
| 扩展 | `attributes` | 最多50项简单标量；结构化核心字段应按上表填写 |

`quality_flag`必须显式提供；保留需求书质量位定义，不能随意分配未知位。温湿度缺失时必须使用非零质量标记。`is_synced`必须显式提供。质量标记为0仅是设备的声明，不等于校准或专业审核通过。

`state`支持`online/idle/teleop/cruise/dwell/returning/charging/fault/offline`。`fault`必须同时带`error_code`。`online`由服务端按状态采样时间计算：最近120秒且非显式离线；上传很旧的历史数据不会让设备变成在线。

## 4. 最小完整采集样例

以下是演示数值，不能当作实测。真实设备必须写入自己的UUID、采样时间和读数。

```json
{
  "schema_version": "WJTJ-mobile-telemetry-1.0",
  "uuid": "0b3f8e2a-4c15-4b7e-9d2a-1f6b0c8e7a35",
  "device_type": "UGV",
  "device_name": "地面移动观测车01",
  "device_id": "UGV_01",
  "task_id": "survey-001",
  "seq": 1,
  "sampled_at_ms": "2026-11-05T00:00:00.000Z",
  "status": {"state": "dwell", "mode": "dwell", "is_synced": true, "unsynced_count": 0},
  "location": {
    "latitude": 34.813,
    "longitude": 113.532,
    "altitude_m": 110,
    "altitude_reference": "amsl",
    "crs": "EPSG:4326",
    "fix_type": "single",
    "speed_mps": 0
  },
  "measurements": {"temperature_c": 28.4, "humidity_pct": 61.2, "sensor_height_agl_m": 1.5},
  "power": {"voltage_v": 24.6, "soc_pct": 82},
  "quality_flag": 0,
  "sensor_id": "SHT30-U1",
  "ugv": {"fan_rpm": 4200, "body_temperature_c": 35.1, "emergency_stop": false}
}
```

UAV使用同样的公共结构，将`device_type`改为`UAV`，使用独立`device_id`并POST到`/uav`；移除`ugv`，加入适用的`uav`字段。必须填`location.altitude_m`，并明确高程基准；相对地面高度另填`uav.altitude_agl_m`。不得把航高温度标为地面2m气温。

独立心跳只需要公共标识、`sampled_at_ms`、`status`及可选`power/attributes`，不需要温湿度和位置；独立GPS只需要公共标识、采样时间和`location`。

## 5. 图片上传与关联

先计算文件原始字节的SHA-256，再将原始二进制内容PUT到`/media/{sha256}`，`Content-Type`为真实图片类型；不要用JSON或Base64包装。支持JPEG、PNG、WebP、TIFF，单文件最多8MiB和2500万像素。接口检查内容哈希、实际文件格式与图片结构。

上传成功返回`storage_uri/sha256/mime_type/size_bytes/width_px/height_px`。将这些返回值放入`visual_frames`条目，再补`frame_id`与`captured_at`；可选`camera_id/modality/capture_location/gsd_cm/metadata`。`frame_id`必须由采集端稳定生成，重传时不变。一次采样最多关联12张图片。

外部引用只接受HTTPS/S3，不接受本地文件、内嵌data URL或URL中携带账号密码。外部文件只存引用，不会服务端主动下载，也不会声称已校验外部内容。平台内上传文件的大小、格式和可选宽高必须与引用元数据匹配。读取图片也必须携带请求头，不能把接入密钥放入URL。

## 6. 重传、乱序与响应

每条新采样生成一个新UUID；同一条采样重试时UUID、任务、序号及内容必须保持不变。`uuid`是全局唯一键；环境观测另有`(device_id, task_id, seq)`唯一约束。完全相同的重试返回`duplicated=1`；同UUID不同内容或同序号冲突返回409。不同设备类型不得复用同一个`device_id`。

```json
{
  "records": ["此处放完整采集对象，不是字符串"]
}
```

实际批量请求`records`中每一项都是采集对象。单批最多500条，同时受JSON总字节限制；有图片元数据时应缩小批次。响应包含`accepted/duplicated/rejected`，拒绝项带数组序号及原因。有效记录可入库，不会因其他记录格式错误全部丢弃。

历史补传保留实际历史时间，不要改成当前上传时间。较旧记录只进入历史，不覆盖新状态或定位。服务端记录独立的`received_at`，未来超过5分钟的采样将被拒绝，以免错误时钟污染当前状态。

状态码：200成功或重复；401凭证无效；404不存在或功能关闭；409幂等/设备类型冲突；413超出请求大小；415图片媒体类型不支持；422字段、图像或时间不合法；503未配置服务凭证。

## 7. 与既有平台的边界

- 接口真正入库，独立状态和GPS可查询，图片可上传并回读；SQLite状态和图片目录需要纳入备份。
- 原`/api/weather/sandbox/validate-telemetry`继续只校验旧IF-02格式；新`/ugv`入口可以直接接收它校验通过的双层UGV报文，并映射到统一结构。原固定节点`/api/backfill`保持原契约。
- 本轮没有新增MQTT消费桥、`/api/backfill/v2`兼容路径、分钟聚合、车机控制或无人机飞控指令。设备可直接使用HTTPS新接口和批量补传。
- 项目版设备管理、观测页和大屏现场设备列表已接入移动观测只读投影。尚未将移动实测自动融合到LCZ模拟底场，响应明确返回`thermal_assimilated=false`；设备校准和观测质量通过后，才应接入后续热场同化。
- `med_eligible=false`，不能把采集端提供的校准编号或质量标记直接认定为医学证据。
- 竞赛版真实移动接口关闭，原竞赛模拟采集功能保持原样。

## 8. 本地验证

```powershell
# 在 decision 目录执行，不会向公网或设备发送测试数据
python -m unittest backend.test_telemetry -q
```

测试使用临时数据库和测试图片，覆盖鉴权、类型约束、幂等并发、批量部分失败、乱序、UTC与毫秒时间、图片上传与回读、恶意图片/路径、旧IF-02兼容及竞赛路由隔离。

## 9. 项目版页面读取（2026-11-12）

开启 `MOBILE_TELEMETRY_PUBLIC_VIEW=1` 后，项目网站像固定传感器页面一样公开展示移动设备观测。默认关闭；AIC 实例与域名始终不可访问。部署前应确认所上报的测点、读数和图片适合在项目网站展示。

- `GET /api/weather/mobile-observations/devices`：设备列表，包含 UGV/UAV、设备 ID、状态及各数据分量的时间。
- `GET /api/weather/mobile-observations/devices/{device_id}?limit=100`：当前数据、历史总数、最近最多200条观测及最近500个有效定位点。
- `GET /api/weather/mobile-observations/images/{sha256}`：已关联至观测记录的图片预览，最长边1280像素，并清除EXIF。原始图像仍走鉴权接口；外部HTTPS/S3链接不会公开或自动加载。

只读接口没有写入、删除或设备控制能力，不返回任意 attributes、图像 metadata 或外部存储 URL。上报接口及原始数据读取仍需 `X-Telemetry-Token`，网页不持有该密钥。温湿度不因新心跳而更新时间；离线或旧读数仍可回看，但大屏不会将其当作当前有效采样。

页面入口：`/sensors` 的设备树新增 UGV、UAV；`/?view=monitor#mobile-observations` 提供移动观测、轨迹和图片。详情每15秒刷新、设备树每30秒刷新；名称使用 UGV / UAV，ID用于区分同类设备。

只读投影测试：`python -m unittest backend.test_telemetry_view -v`。本地页面验收可运行 `python scripts/preview-mobile-observations.py`，使用临时库和标记为验收用途的数据，不连接公网库。
