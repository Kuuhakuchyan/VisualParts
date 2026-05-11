#include "wifi_pos.h"
#include "config.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

static double      _lat      = FIXED_GPS_LAT;
static double      _lon      = FIXED_GPS_LON;
static int         _acc      = 9999;
static bool        _fixed    = false;
static unsigned long _lastMs = 0;

static bool do_locate(double &out_lat, double &out_lon, int &out_acc) {
    Serial.println("WiFiPos: GET 高德 API...");
    HTTPClient http;
    http.setTimeout(5000);

    char url[200];
    snprintf(url, sizeof(url),
        "http://restapi.amap.com/v3/ip?key=%s&output=json", AMAP_KEY);
    Serial.printf("WiFiPos: url=%s\n", url);

    http.begin(url);
    int code = http.GET();
    if (code != 200) {
        Serial.printf("WiFiPos: HTTP %d\n", code);
        http.end();
        return false;
    }

    String resp = http.getString();
    http.end();
    Serial.printf("WiFiPos: raw=%.100s\n", resp.c_str());

    // 高德 IP 定位返回: {"status":"1","info":"OK","province":"..","city":"..","rectangle":"minLng,minLat;maxLng,maxLat"}
    int rectIdx = resp.indexOf("\"rectangle\":\"");
    if (rectIdx < 0) {
        Serial.println("WiFiPos: no rectangle in response");
        return false;
    }

    int start = rectIdx + 13;
    int end = resp.indexOf('"', start);
    if (end < 0) { Serial.println("WiFiPos: parse fail"); return false; }

    String rect = resp.substring(start, end);
    int comma1 = rect.indexOf(',');
    int semi   = rect.indexOf(';');
    int comma2 = rect.indexOf(',', semi);
    if (comma1 < 0 || semi < 0 || comma2 < 0) {
        Serial.printf("WiFiPos: bad rect: %s\n", rect.c_str());
        return false;
    }

    double minLon = rect.substring(0, comma1).toDouble();
    double minLat = rect.substring(comma1 + 1, semi).toDouble();
    double maxLon = rect.substring(semi + 1, comma2).toDouble();
    double maxLat = rect.substring(comma2 + 1).toDouble();

    out_lat = (minLat + maxLat) / 2.0;
    out_lon = (minLon + maxLon) / 2.0;
    out_acc = 10000;

    Serial.printf("WiFiPos: OK %.5f,%.5f ±%dm\n", out_lat, out_lon, out_acc);
    return true;
}

void wifi_pos_setup() {}

void wifi_pos_update() {
    unsigned long now = millis();
    unsigned long remain = (WIFI_POS_INTERVAL_MS > (now - _lastMs))
        ? WIFI_POS_INTERVAL_MS - (now - _lastMs) : 0;
    if (remain > 0) {
        // 每 10s 打印一次倒计时
        static unsigned long lastReport = 0;
        if (now - lastReport >= 10000) {
            lastReport = now;
            Serial.printf("WiFiPos: waiting %lus...\n", remain / 1000);
        }
        return;
    }
    _lastMs = now;

    Serial.printf("WiFiPos: WiFi.status=%d\n", WiFi.status());
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFiPos: STA not connected, skip");
        return;
    }

    double lat, lon; int acc;
    if (do_locate(lat, lon, acc)) {
        _lat = lat; _lon = lon; _acc = acc; _fixed = true;
        Serial.println("WiFiPos: position saved!");
    } else {
        Serial.println("WiFiPos: locate failed");
    }
}

double wifi_pos_get_lat()      { return _lat; }
double wifi_pos_get_lon()      { return _lon; }
int    wifi_pos_get_accuracy() { return _acc; }
bool   wifi_pos_has_fix()      { return _fixed; }
