#include "sta_client.h"
#include "config.h"
#include "rtc.h"
#include "position.h"
#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <sys/time.h>

#ifndef MQTT_MAX_PACKET_SIZE
#define MQTT_MAX_PACKET_SIZE 512
#endif

static WiFiClient    _wifiClient;
static PubSubClient  _mqtt(_wifiClient);
static bool _staOk       = false;
static bool _mqttOk      = false;
static bool _ntpSynced   = false;
static unsigned long _lastReconnectMs   = 0;
static unsigned long _lastMqttRetryMs    = 0;
static unsigned long _lastMqttActivity   = 0;
static int  _retryCount = 0;
static int  _portFailCount = 0;
static const unsigned long RECONNECT_INTERVAL  = 30000UL;
static const unsigned long MQTT_RETRY_INTERVAL = 15000UL;
static const unsigned long HEALTH_TIMEOUT = 90000UL;
static const int MAX_RETRIES = 999;
static const int PORT_FAIL_LIMIT = 5;
static const int PORT_LIST[] = {443, 8081, 1883};
static const int PORT_COUNT = 3;
static int _portIdx = 0;

// 断网补传
#define BACKFILL_SIZE 2400  // 1h20m @ 2s
struct BackfillPoint { unsigned long epoch; float temp; float humid; };
static BackfillPoint _bf[BACKFILL_SIZE];
static int _bfCount = 0, _bfIdx = 0;
static bool _bfNeedsFlush = false;

void backfill_push(unsigned long epoch, float temp, float humid) {
    _bf[_bfIdx].epoch = epoch; _bf[_bfIdx].temp = temp; _bf[_bfIdx].humid = humid;
    _bfIdx = (_bfIdx + 1) % BACKFILL_SIZE;
    if (_bfCount < BACKFILL_SIZE) _bfCount++;
}
bool backfill_needed() { return _bfNeedsFlush; }

static void backfill_flush() {
    if (_bfCount == 0) { _bfNeedsFlush = false; return; }
    if (WiFi.status() != WL_CONNECTED) return;
    HTTPClient http; http.setTimeout(10000);
    http.begin("http://47.97.165.176:8080/api/backfill");
    http.addHeader("Content-Type", "application/json");
    String json; json.reserve(_bfCount * 25 + 100);
    json = "{\"device\":\"" + String(MQTT_DEVICE_ID) + "\",\"data\":[";
    for (int i = 0; i < _bfCount; i++) {
        int idx = (_bfIdx - _bfCount + i + BACKFILL_SIZE) % BACKFILL_SIZE;
        if (i > 0) json += ",";
        char buf[80]; snprintf(buf, sizeof(buf), "[%lu,%.1f,%.1f]", (unsigned long)_bf[idx].epoch, _bf[idx].temp, _bf[idx].humid);
        json += buf;
    }
    json += "]}";
    if (http.POST(json) == 200) { _bfCount = 0; _bfIdx = 0; _bfNeedsFlush = false; }
    http.end();
}

// ====================================================================
// NTP
// ====================================================================
static void ntp_sync() {
    if (_ntpSynced) return;
    configTime(8 * 3600, 0, "ntp.aliyun.com", "ntp1.aliyun.com");
    struct tm tm;
    if (getLocalTime(&tm, 3000)) {
        _ntpSynced = true;
        Serial.printf("NTP: %04d-%02d-%02d %02d:%02d:%02d CST\n",
            tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
            tm.tm_hour, tm.tm_min, tm.tm_sec);
    } else {
        Serial.println("NTP: sync pending...");
    }
}

static void ts_iso8601(char* buf, size_t len) {
    struct timeval tv; gettimeofday(&tv, NULL);
    time_t t = tv.tv_sec;
    struct tm* g = gmtime(&t);
    if (g->tm_year < 126) {
        rtc_get_time_str(buf, len);
        return;
    }
    strftime(buf, len, "%Y-%m-%dT%H:%M:%SZ", g);
}

// ====================================================================
// MQTT
// ====================================================================
static bool mqtt_connect() {
    if (_mqtt.connected()) return true;
    if (WiFi.status() != WL_CONNECTED) return false;
    if (strlen(MQTT_BROKER) == 0) return false;

    int port = PORT_LIST[_portIdx];
    _mqtt.setServer(MQTT_BROKER, port);
    _mqtt.setKeepAlive(120);
    String will = "sensor/" + String(MQTT_DEVICE_ID) + "/status";

    if (_mqtt.connect(MQTT_DEVICE_ID, MQTT_USER, MQTT_PASS,
            will.c_str(), 0, true, "{\"status\":\"offline\"}")) {
        _mqtt.publish(will.c_str(), "{\"status\":\"online\"}", true);
        if (_bfCount > 0) _bfNeedsFlush = true;
        _mqttOk = true; _portFailCount = 0;
        _lastMqttActivity = millis();
        Serial.printf("MQTT: connected %s:%d\n", MQTT_BROKER, port);
        return true;
    }
    _mqttOk = false; _portFailCount++;
    Serial.printf("MQTT: fail port %d rc=%d\n", port, _mqtt.state());
    if (_portFailCount >= PORT_FAIL_LIMIT) { _portIdx = (_portIdx + 1) % PORT_COUNT; _portFailCount = 0; }
    return false;
}

// ====================================================================
// WiFi STA
// ====================================================================
bool sta_init() {
    if (strlen(STA_SSID) == 0) return false;
    WiFi.setSleep(true);             // BLE+WiFi 共存必须开
    WiFi.setAutoReconnect(false);

    Serial.printf("STA: connecting %s", STA_SSID);

    WiFi.begin(STA_SSID, STA_PASS);
    for (int i = 0; i < 30; i++) {
        delay(500); Serial.print(".");
        if (WiFi.status() == WL_CONNECTED) break;
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.print("\nSTA: pause AP, retry...");
        WiFi.mode(WIFI_STA);
        delay(100);
        WiFi.begin(STA_SSID, STA_PASS);
        for (int i = 0; i < 10; i++) {
            delay(500); Serial.print(".");
            if (WiFi.status() == WL_CONNECTED) break;
        }
        WiFi.mode(WIFI_AP_STA);
        delay(50);
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("\nSTA: unavailable (AP only)");
        return false;
    }
    Serial.printf("\nSTA: IP %s\n", WiFi.localIP().toString().c_str());

    ntp_sync();

    if (strlen(MQTT_BROKER) > 0) {
        _staOk = mqtt_connect();
    } else {
        _staOk = true;
    }
    return _staOk;
}

// ====================================================================
// 断线重连
// ====================================================================
void sta_tick() {
    static unsigned long _lastFlush = 0;
    if (_bfNeedsFlush && _mqtt.connected() && millis() - _lastFlush > 30000) { _lastFlush = millis(); backfill_flush(); }
    if (_mqtt.connected()) { _mqtt.loop(); _lastMqttActivity = millis(); }
    if (_mqtt.connected() && millis() - _lastMqttActivity > HEALTH_TIMEOUT) { Serial.println("MQTT: health timeout"); _mqtt.disconnect(); _lastMqttRetryMs = 0; }

    if (strlen(STA_SSID) == 0) return;
    if (_retryCount >= MAX_RETRIES) return;

    if (WiFi.status() != WL_CONNECTED) {
        unsigned long now = millis();
        if (now - _lastReconnectMs < RECONNECT_INTERVAL) return;
        _lastReconnectMs = now;
        _retryCount++;
        _staOk = false;
        _mqttOk = false;

        Serial.printf("STA: retry %d/%d\n", _retryCount, MAX_RETRIES);
        WiFi.mode(WIFI_STA);
        delay(50);
        WiFi.begin(STA_SSID, STA_PASS);
        for (int i = 0; i < 10; i++) {
            delay(200);
            if (WiFi.status() == WL_CONNECTED) break;
        }
        WiFi.mode(WIFI_AP_STA);
        delay(50);
        WiFi.softAP(AP_SSID, AP_PASS);

        if (WiFi.status() == WL_CONNECTED) {
            Serial.println("STA: reconnected");
            ntp_sync();
            _retryCount = 0;
        } else if (_retryCount >= MAX_RETRIES) {
            Serial.println("STA: give up");
            return;
        }
    }

    if (WiFi.status() == WL_CONNECTED && strlen(MQTT_BROKER) > 0) {
        if (_mqtt.connected()) { _staOk = true; _retryCount = 0; }
        else { unsigned long n = millis(); if (n - _lastMqttRetryMs >= MQTT_RETRY_INTERVAL) { _lastMqttRetryMs = n; if (mqtt_connect()) { _staOk = true; _retryCount = 0; } } }
    }
}

// ====================================================================
// 发布
// ====================================================================
bool sta_publish_telemetry(float temp, float humid, float bat_v) {
    if (!_mqtt.connected()) return false;

    char ts[32]; ts_iso8601(ts, sizeof(ts));
    char json[300];
    snprintf(json, sizeof(json),
        "{\"device\":\"%s\",\"ts\":\"%s\","
        "\"temp\":%.1f,\"humid\":%.1f,\"bat\":%.2f}",
        MQTT_DEVICE_ID, ts, temp, humid, bat_v);

    String topic = "sensor/" + String(MQTT_DEVICE_ID) + "/telemetry";
    return _mqtt.publish(topic.c_str(), json);
}

bool sta_publish_gps() {
    if (!_mqtt.connected()) return false;

    char ts[32]; ts_iso8601(ts, sizeof(ts));
    char json[280];
    snprintf(json, sizeof(json),
        "{\"device\":\"%s\",\"ts\":\"%s\","
        "\"lat\":%.6f,\"lon\":%.6f,\"alt\":%.1f,"
        "\"satellites\":%d,\"pos_src\":\"%s\",\"accuracy_m\":%d}",
        MQTT_DEVICE_ID, ts,
        pos_get_lat(), pos_get_lon(),
        pos_get_alt(), pos_get_sats(),
        pos_get_source(), pos_get_accuracy());

    String topic = "sensor/" + String(MQTT_DEVICE_ID) + "/gps";
    return _mqtt.publish(topic.c_str(), json);
}

bool sta_is_connected() {
    return _staOk && (strlen(MQTT_BROKER) == 0 || _mqtt.connected());
}

bool sta_mqtt_connected() {
    return _mqtt.connected();
}
