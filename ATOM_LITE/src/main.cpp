#include <M5Unified.h>

#include "config.h"
#include "sht30.h"
#include "rtc.h"
#include "chart.h"
#include "logger.h"
#include "ws_server.h"
#include "sta_client.h"
#include "ble.h"
#include "led.h"

float ws_lastTemp = NAN, ws_lastHumid = NAN;

unsigned long lastLogTime   = 0;
unsigned long lastChartTime = 0;

static void handleSerial() {
    if (Serial.available() <= 0) return;
    char c = Serial.read();
    if (c == 'd' || c == 'D') logger_dump();
    else if (c == 'c' || c == 'C') { logger_clear(); Serial.println("Cleared"); }
    else if (c == 'i' || c == 'I') Serial.printf("IP: %s\n", ws_get_ip());
}

// ====================================================================
void setup() {
    auto cfg = M5.config();
    cfg.external_rtc = false;  // Atom Lite 无 RTC
    cfg.internal_imu = false;
    cfg.internal_mic = false;
    M5.begin(cfg);

    led_init();
    led_set(LED_BUSY, 80);  // 蓝色 = 初始化中

    Serial.println("=== ATOM Weather ===");

    // SHT30
    led_set(LED_BUSY, 80);
    sht30_init(26, 32);
    if (sht30_is_found()) {
        Serial.println("SHT30: OK");
        led_set(LED_SENSOR, 80);
    } else {
        Serial.println("SHT30: FAIL");
        led_set(LED_ERR, 80);
    }
    delay(500);

    // Logger
    logger_init();
    led_set(LED_BUSY, 80);

    // WiFi AP
    ws_init();
    led_set(LED_WIFI, 80);
    delay(300);

    // BLE
    ble_init();

    // STA (optional)
    if (strlen(STA_SSID) > 0) {
        led_breath(LED_BUSY, 80);
        sta_init();
        if (sta_is_connected()) Serial.println("STA: OK");
    }

    led_breath(LED_OK, 80);  // 绿色呼吸 = 运行中

    Serial.println("=== Ready ===");
    Serial.println("Commands: d=dump, c=clear, i=info");
}

// ====================================================================
void loop() {
    M5.update();
    handleSerial();
    ws_handle();
    led_loop();  // 呼吸灯效果

    float temp = NAN, humid = NAN;
    sht30_read(temp, humid);
    if (!isnan(temp)) ws_lastTemp = temp;
    if (!isnan(humid)) ws_lastHumid = humid;

    unsigned long now = millis();

    // 图表 2s
    if (now - lastChartTime >= CHART_INTERVAL_MS) {
        lastChartTime = now;
        if (!isnan(temp) && !isnan(humid)) chart_add_point(temp, humid);
    }

    // 日志 + BLE + HTTP 30s
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        if (!isnan(temp) && !isnan(humid)) {
            logger_write(temp, humid);

            char ts[24]; rtc_get_time_str(ts, sizeof(ts));
            char buf[256];
            snprintf(buf, sizeof(buf),
                "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\",\"time\":\"%s\"}",
                temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON, ts);
            ble_send(buf);
            sta_send(temp, humid);
        }

        // LED 闪烁确认
        led_set(LED_OK, 80);
        delay(50);
        led_breath(LED_OK, 80);
    }

    delay(200);
}
