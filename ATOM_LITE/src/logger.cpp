#include "logger.h"
#include "config.h"
#include "rtc.h"
#include <LittleFS.h>
#include <cstdio>

static bool       _ok   = false;
static char       _file[32] = "/log.txt";
static int        _lastDay  = -1;
static unsigned long _count = 0, _size = 0;

static void manage_storage() {
    static unsigned long last = 0;
    unsigned long n = millis();
    if (n - last < STORAGE_CHECK_MS) return;
    last = n;

    struct LF { char name[32]; unsigned long sz; } files[50];
    int nf = 0; unsigned long total = 0;
    File r = LittleFS.open("/");
    if (!r || !r.isDirectory()) return;
    
    File f = r.openNextFile();
    while (f && nf < 50) {
        String s = f.name();
        if (s.startsWith("log_")) {
            strncpy(files[nf].name, s.c_str(), 31);
            total += (files[nf].sz = f.size()); nf++;
        }
        f.close(); f = r.openNextFile();
    }
    r.close();
    if (nf <= 5 && total < STORAGE_MAX_BYTES) return;
    for (int i = 0; i < nf-1; i++)
        for (int j = i+1; j < nf; j++)
            if (strcmp(files[i].name, files[j].name) > 0)
                { LF t=files[i]; files[i]=files[j]; files[j]=t; }
    int keep = nf;
    for (unsigned long acc = 0, i = nf-1; (int)i >= 0; i--) {
        acc += files[i].sz;
        if (acc > STORAGE_MAX_BYTES && i > 0) { keep = nf - i; break; }
    }
    if (keep > STORAGE_MAX_DAYS) keep = STORAGE_MAX_DAYS;
    for (int i = 0; i < nf - keep; i++) {
        LittleFS.remove(files[i].name);
        Serial.printf("Clean: %s\n", files[i].name);
    }
}

bool logger_init() {
    _ok = LittleFS.begin();
    if (!_ok) Serial.println("Log: LittleFS mount FAIL (no format)");
    if (_ok) {
        File f = LittleFS.open(_file, FILE_READ);
        if (f) { while (f.available()) if (f.read() == '\n') _count++; _size = f.size(); f.close(); }
    }
    Serial.printf("Log: %s, %lu lines\n", _ok ? "OK" : "FAIL", _count);
    return _ok;
}

void logger_write(float temp, float humid) {
    if (!_ok) return;

    // 日切 (NTP 同步后用真实日期，否则用开机天数)
    int y = 0, m = 0, d = 0;
    bool haveDate = rtc_get_date(y, m, d);
    int dayId = haveDate ? (y * 10000 + m * 100 + d) : (millis() / 86400000UL);
    if (dayId != _lastDay) {
        _lastDay = dayId;
        if (haveDate)
            snprintf(_file, sizeof(_file), "/log_%04d%02d%02d.csv", y, m, d);
        else
            snprintf(_file, sizeof(_file), "/log_day%04d.csv", (int)(millis() / 86400000UL));
        _count = 0;
    }

    File f = LittleFS.open(_file, FILE_APPEND);
    if (!f) return;
    if (f.size() == 0) f.println("datetime,temp_c,humidity_pct,gps_lat,gps_lon");

    char line[128];
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));
    snprintf(line, sizeof(line), "%s,%.1f,%.1f,%.6f,%.6f",
             ts, temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
    f.println(line); _size = f.size(); f.close();
    _count++;
    Serial.println(line);
    manage_storage();
}

void logger_dump() {
    if (!_ok) { Serial.println("FS unavailable"); return; }
    File f = LittleFS.open(_file, FILE_READ);
    if (!f) { Serial.println("No log"); return; }
    Serial.printf("--- %lu bytes ---\n", f.size());
    while (f.available()) Serial.write(f.read());
    Serial.println("\n--- END ---"); f.close();
}

bool logger_clear() {
    if (!_ok) return false;
    LittleFS.remove(_file); _count = 0; _size = 0;
    return true;
}
unsigned long logger_get_count() { return _count; }
unsigned long logger_get_size()  { return _size; }
const char*   logger_get_filename() { return _file; }
