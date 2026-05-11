#include "rtc.h"
#include <cstdio>
#include <Arduino.h>

void rtc_set_from_compile_time() {
    // Atom Lite 无 RTC, 不做任何操作
}

void rtc_get_time_str(char *buf, size_t len) {
    unsigned long ms = millis() / 1000;
    snprintf(buf, len, "UP %02lum %02lus  Day%lu",
             ms / 3600, (ms % 3600) / 60, ms / 86400);
}

int rtc_get_day() {
    return millis() / 86400000UL;  // 近似天数
}
