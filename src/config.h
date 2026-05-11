#pragma once

// ====================================================================
// M5Stick_Weather — 全局配置
// 所有可调参数集中在此文件，方便维护
// ====================================================================

// ---------- SHT30 传感器 ----------
#define SHT30_ADDR      0x44    // I2C 地址 (ENV III)
#define I2C_FREQ        50000   // 50kHz — Grove 长线稳定性
#define SHT30_RETRY     5       // 读失败重试次数

// ---------- 固定 GPS 坐标 (等待 GPS 模块接入) ----------
#define FIXED_GPS_LAT   34.821085
#define FIXED_GPS_LON   113.527073

// ---------- 日志 ----------
#define LOG_INTERVAL_MS   30000UL   // 每 30s 写一次
#define STORAGE_MAX_BYTES 1048576   // 保留上限 1MB
#define STORAGE_MAX_DAYS  14        // 保留上限 14 天
#define STORAGE_CHECK_MS  60000UL   // 存储检查间隔

// ---------- 图表 ----------
#define MAX_CHART_POINTS 110       // 110 点 × 2s ≈ 3 分 40 秒
#define CHART_INTERVAL_MS 2000UL   // 2s 采集间隔

// ---------- WiFi 热点 (AP) ----------
#define AP_SSID  "M5Stick_Weather"
#define AP_PASS  "Dsrdd159987@"

// ---------- WiFi STA + HTTP 服务器 ----------
// 你的服务器接收 POST /api/upload
// (留空则禁用该功能)
#define STA_SSID    ""
#define STA_PASS    ""
#define STA_USER    ""
#define STA_PWD     ""
#define LOGIN_URL   ""
#define SERVER_URL  "http://192.168.1.100:8080"

// ---------- BLE ----------
#define BLE_DEVICE_NAME "M5Stick_Weather"

// ---------- 显示坐标 (240×135 横屏) ----------
#define TITLE_Y      2
#define TIME_Y      20
#define TEMP_Y      36
#define HUMI_Y      58
#define GPS_Y       80
#define BAT_Y       100
#define LOG_Y       120

// ---------- 页面枚举 ----------
enum Page {
    PAGE_DASHBOARD = 0,
    PAGE_TEMPCHART = 1,
    PAGE_HUMICHART = 2,
    PAGE_COUNT = 3
};

// ---------- I2C 引脚扫描 ----------
#define I2C_SCAN_PINS  { {32,33}, {0,26}, {21,22} }
