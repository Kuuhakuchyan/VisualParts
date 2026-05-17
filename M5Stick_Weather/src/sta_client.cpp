#include "sta_client.h"
#include "config.h"
#include "rtc.h"
#include "position.h"
#include <WiFi.h>
#include <PubSubClient.h>
#include <sys/time.h>

#ifndef MQTT_MAX_PACKET_SIZE
#define MQTT_MAX_PACKET_SIZE 512
#endif

static WiFiClient    _wifiClient;
static PubSubClient  _mqtt(_wifiClient);
static bool _staOk       = false;
static bool _mqttOk      = false;
static bool _ntpSynced   = false;
static unsigned long _lastReconnectMs = 0;
static int  _retryCount = 0;
static const unsigned long RECONNECT_INTERVAL = 30000UL;
static const int MAX_RETRIES = 5;

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

    _mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    String will = "sensor/" + String(MQTT_DEVICE_ID) + "/status";

    if (_mqtt.connect(MQTT_DEVICE_ID, NULL, NULL,
            will.c_str(), 0, true, "{\"status\":\"offline\"}")) {
        _mqtt.publish(will.c_str(), "{\"status\":\"online\"}", true);
        _mqttOk = true;
        Serial.printf("MQTT: connected %s:%d\n", MQTT_BROKER, MQTT_PORT);
        return true;
    }
    _mqttOk = false;
    Serial.printf("MQTT: connect fail rc=%d\n", _mqtt.state());
    return false;
}

// ====================================================================
// WiFi STA
// ====================================================================
bool sta_init() {
    if (strlen(STA_SSID) == 0) return false;
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
    if (_mqtt.connected()) _mqtt.loop();

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
        if (_mqtt.connected()) {
            _staOk = true;
            _retryCount = 0;
        } else if (mqtt_connect()) {
            _staOk = true;
            _retryCount = 0;
        }
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
