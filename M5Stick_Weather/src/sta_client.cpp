#include "sta_client.h"
#include "config.h"
#include "rtc.h"
#include "position.h"
#include <WiFi.h>
#include <HTTPClient.h>

static bool _ok = false;
static unsigned long _lastTryMs = 0;
static int _retryCount = 0;
static const unsigned long RECONNECT_INTERVAL = 30000UL; // 30s 间隔
static const int MAX_RETRIES = 10;                       // 最多尝试 10 次后放弃

bool sta_init() {
    if (strlen(STA_SSID) == 0) return false;
    WiFi.setAutoReconnect(false); // 禁止 ESP32 自动频繁重连
    Serial.printf("STA: connecting %s\n", STA_SSID);
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(STA_SSID, STA_PASS);
    for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
    if (WiFi.status() != WL_CONNECTED) { Serial.println("\nSTA: fail (will retry later)"); return false; }
    Serial.printf("\nSTA: IP %s\n", WiFi.localIP().toString().c_str());

    // 校园网 Portal 认证
    if (strlen(LOGIN_URL) > 0 && strlen(STA_USER) > 0 && strlen(STA_PWD) > 0) {
        HTTPClient h;
        h.begin("http://connectivitycheck.gstatic.com/generate_204");
        int r = h.GET(); h.end();
        Serial.printf("STA: connectivity check %d\n", r);
        if (r != 204) {
            HTTPClient l;
            l.begin(LOGIN_URL);
            l.addHeader("Content-Type", "application/x-www-form-urlencoded");
            int c = l.POST("username=" + String(STA_USER)
                        + "&password=" + String(STA_PWD));
            Serial.printf("STA: portal login %d\n", c);
            l.end();
            delay(2000);
        }
    }
    _ok = true;
    return true;
}

/** 主循环中定期调用, 尝试 5 次后放弃重连 */
void sta_tick() {
    if (strlen(STA_SSID) == 0) return;
    if (_retryCount >= MAX_RETRIES) return;     // 已放弃重连
    if (WiFi.status() == WL_CONNECTED) { _ok = true; _retryCount = 0; return; }

    unsigned long now = millis();
    if (now - _lastTryMs < RECONNECT_INTERVAL) return;
    _lastTryMs = now;
    _ok = false;
    _retryCount++;
    Serial.printf("STA: retry %d/%d...\n", _retryCount, MAX_RETRIES);

    WiFi.begin(STA_SSID, STA_PASS);
    for (int i = 0; i < 10; i++) { delay(200); if (WiFi.status() == WL_CONNECTED) break; }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("STA: reconnected, IP %s\n", WiFi.localIP().toString().c_str());
        _ok = true;
        _retryCount = 0;
    } else if (_retryCount >= MAX_RETRIES) {
        Serial.println("STA: give up (max retries)");
    }
}

bool sta_send(float temp, float humid, float bat_v) {
    if (!_ok || strlen(SERVER_URL) == 0) return false;
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));
    double lat = pos_get_lat();
    double lon = pos_get_lon();
    const char* src = pos_get_source();
    char json[320]; snprintf(json, sizeof(json),
        "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\","
        "\"bat\":%.2f,\"time\":\"%s\",\"device\":\"M5StickC_Plus2\",\"pos_src\":\"%s\"}",
        temp, humid, lat, lon, bat_v, ts, src);
    HTTPClient h; h.begin(String(SERVER_URL) + "/api/upload");
    h.addHeader("Content-Type", "application/json");
    int c = h.POST(json); h.end();
    return c == 200;
}

bool sta_is_connected() { return _ok; }





