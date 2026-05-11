#include "sta_client.h"
#include "config.h"
#include "rtc.h"
#include <WiFi.h>
#include <HTTPClient.h>

static bool _ok = false;

bool sta_init() {
    if (strlen(STA_SSID) == 0) return false;
    Serial.printf("STA: connecting %s\n", STA_SSID);
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(STA_SSID, STA_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
    if (WiFi.status() != WL_CONNECTED) return false;
    Serial.printf("\nSTA: IP %s\n", WiFi.localIP().toString().c_str());

    // 校园网认证
    if (strlen(LOGIN_URL) > 0 && strlen(STA_USER) > 0 && strlen(STA_PWD) > 0) {
        HTTPClient h; h.begin("http://connectivitycheck.gstatic.com/generate_204");
        int r = h.GET(); h.end();
        if (r == 302 || r == 301) {
            HTTPClient l; l.begin(LOGIN_URL);
            l.addHeader("Content-Type", "application/x-www-form-urlencoded");
            int c = l.POST("username=" + String(STA_USER) + "&password=" + String(STA_PWD));
            Serial.printf("STA: login %d\n", c); l.end();
            delay(1000);
        }
    }
    _ok = true;
    return true;
}

bool sta_send(float temp, float humid, float bat_v) {
    if (!_ok || strlen(SERVER_URL) == 0) return false;
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));
    char json[256]; snprintf(json, sizeof(json),
        "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\","
        "\"bat\":%.2f,\"time\":\"%s\",\"device\":\"M5StickC_Plus2\"}",
        temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON, bat_v, ts);
    HTTPClient h; h.begin(String(SERVER_URL) + "/api/upload");
    h.addHeader("Content-Type", "application/json");
    int c = h.POST(json); h.end();
    return c == 200;
}

bool sta_is_connected() { return _ok; }
