#pragma once

/**
 * 统一位置接口
 * 优先级: GPS (ATGM336H 模块) > WiFi 定位 (百度 LBS) > 默认固定坐标
 */
void    pos_setup();
void    pos_update();
double  pos_get_lat();
double  pos_get_lon();
float   pos_get_alt();
int     pos_get_sats();
int     pos_get_accuracy();   // 精度半径 (m)
bool    pos_has_fix();
const char* pos_get_source(); // "GPS", "WiFi", "Fixed"
bool    pos_is_gps_mode();
