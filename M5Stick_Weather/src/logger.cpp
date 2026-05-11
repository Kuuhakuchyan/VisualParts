#include "logger.h"
#include "config.h"
#include <M5Unified.h>
#include <LittleFS.h>

static bool       _ok   = false;
static char       _file[32] = "/log.txt";
static int        _lastDay  = 0;
static unsigned long _count = 0;
static unsigned long _size  = 0;

// ---------- 存储管理 ----------
static void manage_storage() {
    static unsigned long lastCheck = 0;
    unsigned long now = millis();
    if (now - lastCheck < STORAGE_CHECK_MS) return;
    lastCheck = now;

    struct LF { char name[32]; unsigned long sz; };
    LF files[50]; int n = 0; unsigned long total = 0;

    File root = LittleFS.open("/");
    if (!root || !root.isDirectory()) return;
    File f = root.openNextFile();
    while (f && n < 50) {
        String s = f.name();
        if (s.startsWith("log_")) {
            strncpy(files[n].name, s.c_str(), 31);
            total += (files[n].sz = f.size());
            n++;
        }
        f.close(); f = root.openNextFile();
    }
    root.close();
    if (n <= 5 && total < STORAGE_MAX_BYTES) return;

    // 排序 (日期序)
    for (int i = 0; i < n-1; i++)
        for (int j = i+1; j < n; j++)
            if (strcmp(files[i].name, files[j].name) > 0)
                { LF t=files[i]; files[i]=files[j]; files[j]=t; }

    int keep = n;
    for (unsigned long acc = 0, i = n-1; i < (unsigned long)n; i--) {
        acc += files[i].sz;
        if (acc > STORAGE_MAX_BYTES && i > 0) { keep = n - i; break; }
    }
    if (keep > STORAGE_MAX_DAYS) keep = STORAGE_MAX_DAYS;
    for (int i = 0; i < n - keep; i++) {
        LittleFS.remove(files[i].name);
        Serial.printf("Clean: removed %s\n", files[i].name);
    }
}

// ---------- 初始化 ----------
bool logger_init() {
    _ok = LittleFS.begin();
    if (!_ok) { LittleFS.format(); _ok = LittleFS.begin(); }
    if (_ok) {
        File f = LittleFS.open(_file, FILE_READ);
        if (f) {
            while (f.available()) { if (f.read() == '\n') _count++; }
            _size = f.size(); f.close();
        }
    }
    Serial.printf("Log: %s, %lu lines\n", _ok ? "OK" : "FAIL", _count);
    return _ok;
}

// ---------- 写入 ----------
void logger_write(float temp, float humid) {
    if (!_ok) return;
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();

    // 每日归档
    if (now.date.year >= 2025 && now.date.date != _lastDay) {
        _lastDay = now.date.date;
        snprintf(_file, sizeof(_file), "/log_%04d%02d%02d.csv",
                 now.date.year, now.date.month, now.date.date);
        _count = 0;
    }

    File f = LittleFS.open(_file, FILE_APPEND);
    if (!f) return;
    if (f.size() == 0) f.println("datetime,temp_c,humidity_pct,gps_lat,gps_lon");

    char line[128];
    if (now.date.year >= 2025)
        snprintf(line, sizeof(line), "%04d-%02d-%02d %02d:%02d:%02d,%.1f,%.1f,%.6f,%.6f",
                 now.date.year, now.date.month, now.date.date,
                 now.time.hours, now.time.minutes, now.time.seconds,
                 temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
    else {
        unsigned long ms = millis()/1000;
        snprintf(line, sizeof(line), "1970-01-01 00:%02lu:%02lu,%.1f,%.1f,%.6f,%.6f",
                 ms/60, ms%60, temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
    }
    f.println(line); _size = f.size(); f.close();
    _count++;
    Serial.println(line);
    manage_storage();
}

// ---------- 串口导出 ----------
void logger_dump() {
    if (!_ok) { Serial.println("FS not available"); return; }
    File f = LittleFS.open(_file, FILE_READ);
    if (!f) { Serial.println("No log file yet"); return; }
    Serial.printf("--- LOG DUMP (%lu bytes) ---\n", f.size());
    while (f.available()) Serial.write(f.read());
    Serial.println("\n--- END ---"); f.close();
}

bool logger_clear() {
    if (!_ok) return false;
    LittleFS.remove(_file); _count = 0; _size = 0;
    return true;
}

unsigned long logger_get_count()  { return _count; }
unsigned long logger_get_size()   { return _size; }
const char*   logger_get_filename() { return _file; }
