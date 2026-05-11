#include "wifi_pos.h"
#include "config.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

static double      _lat      = FIXED_GPS_LAT;
static double      _lon      = FIXED_GPS_LON;
static int         _acc      = 9999;
static bool        _fixed    = false;
static unsigned long _lastMs = 0;

/** 扫描 WiFi → POST 到百度 LBS → 解析经纬度 */
static bool do_locate(double &out_lat, double &out_lon, int &out_acc) {
    int n = WiFi.scanNetworks(false, true);
    if (n <= 0) { Serial.println("WiFiPos: scan 0 APs"); return false; }
    if (n > 20) n = 20;

    // 构建 JSON body (手动拼接, 避免引入 ArduinoJson)
    String body = "{\"wifi\":[";
    for (int i = 0; i < n; i++) {
        if (i > 0) body += ',';
        body += "{\"mac\":\"" + WiFi.BSSIDstr(i)
              + "\",\"signal\":" + WiFi.RSSI(i) + '}';
    }
    body += "]}";

    // HTTPS POST 到百度
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    char url[256];
    snprintf(url, sizeof(url),
        "https://api.map.baidu.com/geolocation/v1/geolocation"
        "?ak=%s&coordtype=wgs84&output=json", BAIDU_LBS_AK);

    http.begin(client, url);
    http.addHeader("Content-Type", "application/json; charset=utf-8");
    int code = http.POST(body);
    String resp = http.getString();
    http.end();
    WiFi.scanDelete();

    if (code != 200) {
        Serial.printf("WiFiPos: HTTP %d\n", code);
        return false;
    }

    // 解析 JSON 响应 (手动查找字段)
    int li = resp.indexOf("\"lat\":");
    int ln = resp.indexOf("\"lng\":");
    int pr = resp.indexOf("\"precision\":");
    if (li < 0 || ln < 0) { Serial.println("WiFiPos: no lat/lng in resp"); return false; }

    int st = resp.indexOf("\"status\":");
    if (st >= 0) {
        int s = resp.substring(st + 9, resp.indexOf(',', st)).toInt();
        if (s != 0) { Serial.printf("WiFiPos: status %d\n", s); return false; }
    }

    out_lat = resp.substring(li + 6, resp.indexOf(',', li)).toDouble();
    out_lon = resp.substring(ln + 6, resp.indexOf(',', ln)).toDouble();
    out_acc = (pr > 0) ? resp.substring(pr + 12, resp.indexOf(',', pr)).toInt() : 100;
    if (out_acc <= 0) out_acc = 100;

    Serial.printf("WiFiPos: %.6f,%.6f ±%dm (%d APs)\n", out_lat, out_lon, out_acc, n);
    return true;
}

void wifi_pos_setup() {}

void wifi_pos_update() {
    unsigned long now = millis();
    if (now - _lastMs < WIFI_POS_INTERVAL_MS) return;
    _lastMs = now;

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFiPos: STA not connected");
        return;
    }

    double lat, lon; int acc;
    if (do_locate(lat, lon, acc)) {
        _lat = lat; _lon = lon; _acc = acc; _fixed = true;
    }
}

double wifi_pos_get_lat()      { return _lat; }
double wifi_pos_get_lon()      { return _lon; }
int    wifi_pos_get_accuracy() { return _acc; }
bool   wifi_pos_has_fix()      { return _fixed; }
