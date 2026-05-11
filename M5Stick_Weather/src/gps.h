#pragma once

/**
 * ATGM336H (北斗+GPS 双模) NMEA 解析器
 *
 * 接线: G26 (UART2 RX) → ATGM336H TX
 *       ATGM336H 未接线或未定位时自动返回无效状态
 */
void    gps_init();
void    gps_update();       // 主循环中每帧调用
double  gps_get_lat();      // 十进制纬度
double  gps_get_lon();      // 十进制经度
float   gps_get_alt();      // 海拔 (m)
int     gps_get_sats();     // 卫星数
bool    gps_has_fix();      // 是否定位成功
bool    gps_get_fresh();    // 最近 5s 内是否收到有效定位
