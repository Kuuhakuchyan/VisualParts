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

// ---------- WiFi STA + 校园网认证 ----------
// STA_SSID/STA_PASS: WiFi 连接凭据 (开放网络留空)
// STA_USER/STA_PWD:  校园网 Portal 认证账号
// LOGIN_URL:         Portal POST 地址 (非页面地址)
#define STA_SSID    "MCMer"
#define STA_PASS    "0d000721"
#define STA_USER    ""
#define STA_PWD     ""
#define LOGIN_URL   ""

// ---------- HTTP 服务器 ----------
#define SERVER_URL  ""

// ---------- WiFi 定位 (Unwired Labs) ----------
// https://unwiredlabs.com — 免费注册获取 token (格式 pk.xxxxxxxx)
#define UNWIRED_TOKEN   "pk.0876d19a5a65b9a877aed0e4c93bbbbc"
#define WIFI_POS_INTERVAL_MS  60000UL   // 每隔 60s 扫描+定位一次

// ---------- GPS 接口 (ATGM336H) ----------
// 底部排针 G26 (UART2 RX)
#define GPS_RX_PIN   26

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
