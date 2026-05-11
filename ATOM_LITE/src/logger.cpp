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
    if (!_ok) { LittleFS.format(); _ok = LittleFS.begin(); }
    if (_ok) {
        File f = LittleFS.open(_file, FILE_READ);
        if (f) { while (f.available()) if (f.read() == '\n') _count++; _size = f.size(); f.close(); }
    }
    Serial.printf("Log: %s, %lu lines\n", _ok ? "OK" : "FAIL", _count);
    return _ok;
}

void logger_write(float temp, float humid) {
    if (!_ok) return;

    // 日切 (用 rtc_get_day)
    int day = rtc_get_day();
    if (day != _lastDay) {
        _lastDay = day;
        unsigned long d = millis() / 86400000UL;
        snprintf(_file, sizeof(_file), "/log_day%04lu.csv", d);
        _count = 0;
    }

    File f = LittleFS.open(_file, FILE_APPEND);
    if (!f) return;
    if (f.size() == 0) f.println("uptime_s,temp_c,humidity_pct,gps_lat,gps_lon");

    unsigned long ms = millis() / 1000;
    char line[128];
    snprintf(line, sizeof(line), "%lu,%.1f,%.1f,%.6f,%.6f",
             ms, temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
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
