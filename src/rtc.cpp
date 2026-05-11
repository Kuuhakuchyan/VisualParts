#include "rtc.h"
#include <M5Unified.h>
#include <cstdio>

void rtc_set_from_compile_time() {
    const char* months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0}; int d, y, h, m, s;
    sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
    sscanf(__TIME__, "%d:%d:%d", &h, &m, &s);
    int month = 0; const char* p = months;
    for (int i = 1; i <= 12; i++) {
        if (strncmp(mon, p, 3) == 0) { month = i; break; } p += 3;
    }
    m5::rtc_datetime_t dt;
    dt.date.year=y; dt.date.month=month; dt.date.date=d;
    dt.time.hours=h; dt.time.minutes=m; dt.time.seconds=s;
    M5.Rtc.setDateTime(&dt);
    Serial.printf("RTC set from build: %04d-%02d-%02d %02d:%02d:%02d\n", y, month, d, h, m, s);
}

void rtc_get_time_str(char *buf, size_t len) {
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();
    if (now.date.year >= 2025 && now.date.year <= 2099)
        snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
                 now.date.year, now.date.month, now.date.date,
                 now.time.hours, now.time.minutes, now.time.seconds);
    else {
        unsigned long ms = millis()/1000;
        snprintf(buf, len, "UP %02lum%02lus", ms/60, ms%60);
    }
}
