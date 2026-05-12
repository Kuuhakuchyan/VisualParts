#include "sta_client.h"
#include "config.h"
#include "rtc.h"
#include "position.h"
#include <WiFi.h>
#include <HTTPClient.h>

static bool _ok = false;
static unsigned long _lastTryMs = 0;
static int _retryCount = 0;
static const unsigned long RECONNECT_INTERVAL = 30000UL;
static const int MAX_RETRIES = 10;

bool sta_init() {
    if (strlen(STA_SSID) == 0) return false;
    WiFi.setAutoReconnect(false);

    Serial.printf("STA: trying %s\n", STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);

    for (int i = 0; i < 20; i++) {
        delay(500);
        Serial.print(".");
        if (WiFi.status() == WL_CONNECTED) break;
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("\nSTA: not available (background retry active)");
        return false;
    }
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

void sta_tick() {
    if (strlen(STA_SSID) == 0) return;
    if (_retryCount >= MAX_RETRIES) return;
    if (WiFi.status() == WL_CONNECTED) { _ok = true; _retryCount = 0; return; }

    unsigned long now = millis();
    if (now - _lastTryMs < RECONNECT_INTERVAL) return;
    _lastTryMs = now;
    _retryCount++;
    _ok = false;

    Serial.printf("STA: retry %d/%d (AP pause)\n", _retryCount, MAX_RETRIES);

    // 临时切 STA-only, AP 停止广播约 2.5s
    WiFi.mode(WIFI_STA);
    delay(50);
    WiFi.begin(STA_SSID, STA_PASS);

    for (int i = 0; i < 10; i++) {
        delay(200);
        if (WiFi.status() == WL_CONNECTED) break;
    }

    // 恢复 AP
    WiFi.mode(WIFI_AP_STA);
    delay(50);
    WiFi.softAP(AP_SSID, AP_PASS);

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("STA: reconnected");
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
