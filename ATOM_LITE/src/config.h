#pragma once

// ====================================================================
// ATOM Lite 全局配置
// ====================================================================

// ---------- SHT30 ----------
#define SHT30_ADDR      0x44
#define I2C_FREQ        50000
#define SHT30_RETRY     5
#define I2C_SCAN_PINS  { {26,32}, {0,26}, {21,22} } // Atom: G26/G32

// ---------- GPS ----------
#define FIXED_GPS_LAT   34.821085
#define FIXED_GPS_LON   113.527073

// ---------- 日志 ----------
#define LOG_INTERVAL_MS   30000UL
#define STORAGE_MAX_BYTES 1048576
#define STORAGE_MAX_DAYS  14
#define STORAGE_CHECK_MS  60000UL

// ---------- 图表 ----------
#define MAX_CHART_POINTS 110
#define CHART_INTERVAL_MS 2000UL

// ---------- WiFi 热点 ----------
#define AP_SSID  "ATOM_Weather"
#define AP_PASS  "12345678"

// ---------- STA + 服务器 ----------
#define STA_SSID    ""
#define STA_PASS    ""
#define STA_USER    ""
#define STA_PWD     ""
#define LOGIN_URL   ""
#define SERVER_URL  "http://192.168.1.100:8080"

// ---------- BLE ----------
#define BLE_DEVICE_NAME "ATOM_Weather"

// ---------- LED 颜色 ----------
#define LED_OK      0x00FF00  // 绿
#define LED_ERR     0xFF0000  // 红
#define LED_BUSY    0x0000FF  // 蓝
#define LED_SENSOR  0x00FFFF  // 青
#define LED_WIFI    0xFF00FF  // 紫
