#include "position.h"
#include "config.h"
#include "gps.h"
#include "wifi_pos.h"

void pos_setup() {
    gps_init();
    wifi_pos_setup();
}

void pos_update() {
    gps_update();        // 每帧尝试读 UART
    wifi_pos_update();   // 内部 60s 节流
}

double pos_get_lat() {
    if (gps_has_fix() && gps_get_fresh()) return gps_get_lat();
    return FIXED_GPS_LAT;
}

double pos_get_lon() {
    if (gps_has_fix() && gps_get_fresh()) return gps_get_lon();
    return FIXED_GPS_LON;
}

float pos_get_alt() {
    if (gps_has_fix() && gps_get_fresh()) return gps_get_alt();
    return 0;
}

int pos_get_sats() {
    if (gps_has_fix() && gps_get_fresh()) return gps_get_sats();
    return 0;
}

int pos_get_accuracy() {
    if (gps_has_fix() && gps_get_fresh()) return 5;
    return 9999;
}

bool pos_has_fix() {
    return true;  // 默认固定坐标始终可用
}

const char* pos_get_source() {
    if (gps_has_fix() && gps_get_fresh()) return "GPS";
    return "Fixed";
}

bool pos_is_gps_mode() {
    return gps_has_fix() && gps_get_fresh();
}
