#pragma once

/**
 * WiFi 定位 (百度 LBS Geolocation API)
 *
 * 原理: 扫描周围 WiFi 热点 MAC→POST 到百度 LBS→返回经纬度
 * 频率: 由 WIFI_POS_INTERVAL_MS (config.h) 控制, 默认 60s
 */
void wifi_pos_setup();
void wifi_pos_update();       // 主循环调用, 自动节流
double wifi_pos_get_lat();
double wifi_pos_get_lon();
int    wifi_pos_get_accuracy(); // 精度半径 (m)
bool   wifi_pos_has_fix();      // 是否成功定位过至少一次
