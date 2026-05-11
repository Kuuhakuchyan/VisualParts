#include <M5Unified.h>

#include "config.h"
#include "sht30.h"
#include "rtc.h"
#include "chart.h"
#include "logger.h"
#include "display.h"
#include "ws_server.h"
#include "sta_client.h"
#include "ble.h"

// ---------- 全局共享状态 ----------
float lastTemp  = NAN;
float lastHumid = NAN;

Page  currentPage = PAGE_DASHBOARD;
unsigned long lastLogTime   = 0;
unsigned long lastChartTime = 0;
bool          collecting    = true;  // BtnB / 串口 's' 切换

// ---------- 串口命令 ----------
static void handleSerial() {
    if (Serial.available() <= 0) return;
    char cmd = Serial.read();
    if (cmd == 'd' || cmd == 'D')        logger_dump();
    else if (cmd == 'c' || cmd == 'C') { logger_clear(); Serial.println("Log cleared"); }
    else if (cmd == 'i' || cmd == 'I')   Serial.printf("AP: %s | IP: %s\n", AP_SSID, webserver_get_ip());
    else if (cmd == 's' || cmd == 'S') { collecting = !collecting; Serial.printf("Collect: %s\n", collecting ? "ON" : "OFF"); }
}

// ====================================================================
void setup() {
    auto cfg = M5.config(); M5.begin(cfg);
    display_init();
    M5.Display.fillScreen(BLACK);
    draw_title();
    draw_diag("Init SHT30...", 0);

    // SHT30
    sht30_init(32, 33);
    draw_diag(sht30_is_found() ? "SHT30 OK" : "SHT30 FAIL", 1);
    if (!sht30_is_found()) {
        draw_diag("Check wiring", 2);
        delay(2000);
    }

    // RTC
    draw_diag("RTC...", 2);
    m5::rtc_datetime_t rtc_now = M5.Rtc.getDateTime();
    if (rtc_now.date.year < 2025 || rtc_now.date.year > 2035) rtc_set_from_compile_time();

    // Logger
    draw_diag("FS...", 3);
    logger_init();

    // WiFi AP + Web server
    draw_diag("Starting AP...", 4);
    webserver_init();
    draw_diag(webserver_get_ip(), 4);

    // BLE
    ble_init();

    // WiFi STA
    if (strlen(STA_SSID) > 0) {
        draw_diag("Connecting STA...", 5);
        sta_init();
        draw_diag(sta_is_connected() ? "STA OK" : "STA fail", 5);
    }

    // 初始仪表盘
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));
    draw_dashboard(NAN, NAN, M5.Power.getBatteryVoltage() / 1000.0f, true, ts);
    draw_log_line(logger_get_count(), logger_get_size());

    Serial.println("--- System Ready ---");
    Serial.println("Commands: d=dump, c=clear, i=info");
}

// ====================================================================
void loop() {
    M5.update();
    handleSerial();
    webserver_handle();

    // 读取传感器
    float temp = NAN, humid = NAN;
    sht30_read(temp, humid);
    if (!isnan(temp))  lastTemp  = temp;
    if (!isnan(humid)) lastHumid = humid;
    float batVol = M5.Power.getBatteryVoltage() / 1000.0f;

    // 页面切换 (BtnA)
    if (M5.BtnA.wasPressed())
        currentPage = (Page)((currentPage + 1) % PAGE_COUNT);

    // 采集启停 (BtnB)
    if (M5.BtnB.wasPressed()) {
        collecting = !collecting;
        Serial.printf("Collect: %s\n", collecting ? "ON" : "OFF");
    }

    unsigned long now = millis();
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));

    // 页面渲染 (采集暂停时仍可查看)
    if (currentPage == PAGE_DASHBOARD) {
        draw_dashboard(temp, humid, batVol, true, ts);
    } else {
        const char* title = (currentPage == PAGE_TEMPCHART) ? "Temp Trend" : "Humi Trend";
        uint16_t    color = (currentPage == PAGE_TEMPCHART) ? CYAN : YELLOW;
        const char* unit  = (currentPage == PAGE_TEMPCHART) ? "C" : "%";
        float*      data  = (currentPage == PAGE_TEMPCHART) ? chart_get_temp_ptr() : chart_get_humid_ptr();
        draw_line_chart(title, color, data, chart_get_count(), unit, ts);
    }
    // 右上角状态灯: 绿=采集中 红=暂停
    M5.Display.fillCircle(228, 10, 4, collecting ? GREEN : RED);
    M5.Display.drawCircle(228, 10, 4, WHITE);

    // ---- 暂停时跳过所有采集 ----
    if (!collecting) { delay(200); return; }

    // 图表采集 (2s)
    if (now - lastChartTime >= CHART_INTERVAL_MS) {
        lastChartTime = now;
        if (!isnan(temp) && !isnan(humid)) chart_add_point(temp, humid);
    }

    // 页面渲染
    if (currentPage == PAGE_DASHBOARD) {
        draw_dashboard(temp, humid, batVol, true, ts);
    } else {
        const char* title = (currentPage == PAGE_TEMPCHART) ? "Temp Trend" : "Humi Trend";
        uint16_t    color = (currentPage == PAGE_TEMPCHART) ? CYAN : YELLOW;
        const char* unit  = (currentPage == PAGE_TEMPCHART) ? "C" : "%";
        float*      data  = (currentPage == PAGE_TEMPCHART) ? chart_get_temp_ptr() : chart_get_humid_ptr();
        draw_line_chart(title, color, data, chart_get_count(), unit, ts);
    }

    // 日志 + BLE + HTTP (30s)
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        if (!isnan(temp) && !isnan(humid)) {
            logger_write(temp, humid);

            // BLE
            char bleBuf[256];
            snprintf(bleBuf, sizeof(bleBuf),
                "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\","
                "\"bat\":%.2f,\"time\":\"%s\"}",
                temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON, batVol, ts);
            ble_send(bleBuf);

            // HTTP push
            sta_send(temp, humid, batVol);
        }
        if (currentPage == PAGE_DASHBOARD)
            draw_log_line(logger_get_count(), logger_get_size());
    }

    delay(200);
}
