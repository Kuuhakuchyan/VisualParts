#pragma once

// ====================================================================
// ATOM Lite 全局配置
// ====================================================================

// ---------- SHT30 ----------
#define SHT30_ADDR      0x44
#define I2C_FREQ        50000
#define SHT30_RETRY     5
#define I2C_SCAN_PINS  { {26,32}, {0,26}, {21,22} }

// ---------- 固定坐标 (GPS 模块接入后自动切换) ----------
#define FIXED_GPS_LAT   34.821083
#define FIXED_GPS_LON   113.527070

// ---------- 日志 ----------
#define LOG_INTERVAL_MS   2000UL   // 2s 上报 (秒级 CSV)
#define STORAGE_MAX_BYTES 1048576
#define STORAGE_MAX_DAYS  14
#define STORAGE_CHECK_MS  60000UL

// ---------- 图表 ----------
#define MAX_CHART_POINTS 110
#define CHART_INTERVAL_MS 2000UL

// ---------- WiFi 热点 ----------
#define AP_SSID  "ATOM_Weather"
#define AP_PASS  "Dsrdd159987@"

// ---------- WiFi STA (暂禁用, 使用 AP 直连) ----------
#define STA_SSID    "GL-MT300N-V2-581-Weather1"
#define STA_PASS    "Dsrdd159987@"
#define STA_USER    ""
#define STA_PWD     ""
#define LOGIN_URL   ""

// ---------- MQTT ----------
// ---- 阿里云生产 (当前生效) ----
#define MQTT_BROKER     "47.97.165.176"
#define MQTT_PORT       8081                        // 校园网暂用
// ---- 本地开发 (上线时取消注释, 注释上面两行, 替换为 Windows 局域网 IP) ----
// #define MQTT_BROKER     "192.168.137.1"
// #define MQTT_PORT       1883
#define MQTT_DEVICE_ID  "ATOM_LITE_01"
#define MQTT_USER       "ATOM_LITE_01"
#define MQTT_PASS       "Dsrdd159987@"

// ---------- HTTP 服务器 (已弃用, MQTT 替代) ----------
#define SERVER_URL  ""

// ---------- 天地图 (Leaflet 瓦片图层) ----------
#define AMAP_TK   "3f612f90e997ebccbf74793fdf6d9264"

// ---------- WiFi 定位 (高德 IP 定位) ----------
#define AMAP_KEY   "a0481addec6dc5d01360c4e6b03d18a4"
#define WIFI_POS_INTERVAL_MS  0UL  // 禁用 (restapi.amap.com 不通, 阻塞 MQTT)

// ---------- GPS 接口 (ATGM336H) ----------
#define GPS_RX_PIN   26

// ---------- BLE ----------
#define BLE_DEVICE_NAME "ATOM_Weather"

// ---------- LED 颜色 ----------
#define LED_OK      0x00FF00
#define LED_ERR     0xFF0000
#define LED_BUSY    0x0000FF
#define LED_SENSOR  0x00FFFF
#define LED_WIFI    0xFF00FF












