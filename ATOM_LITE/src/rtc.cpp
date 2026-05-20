#include "rtc.h"
#include <cstdio>
#include <Arduino.h>
#include <sys/time.h>

void rtc_set_from_compile_time() {
    // Atom Lite 无 RTC, 不做任何操作
}

void rtc_get_time_str(char *buf, size_t len) {
    struct timeval tv; gettimeofday(&tv, NULL);
    struct tm *t = localtime(&tv.tv_sec);
    // NTP 已同步 → 显示真实时间; 否则 fallback 开机时间
    if (t->tm_year >= 126) {  // year >= 2026
        snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
                 t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
                 t->tm_hour, t->tm_min, t->tm_sec);
    } else {
        unsigned long ms = millis() / 1000;
        snprintf(buf, len, "UP %02lum %02lus  Day%lu",
                 ms / 3600, (ms % 3600) / 60, ms / 86400);
    }
}

int rtc_get_day() {
    struct timeval tv; gettimeofday(&tv, NULL);
    struct tm *t = localtime(&tv.tv_sec);
    if (t->tm_year >= 126)
        return t->tm_mday;  // 真实日 (1-31)
    return millis() / 86400000UL;  // fallback
}

bool rtc_get_date(int &year, int &month, int &day) {
    struct timeval tv; gettimeofday(&tv, NULL);
    struct tm *t = localtime(&tv.tv_sec);
    if (t->tm_year < 126) return false;
    year  = t->tm_year + 1900;
    month = t->tm_mon + 1;
    day   = t->tm_mday;
    return true;
}
