#include <M5Unified.h>
#include <LittleFS.h>
#include <time.h>
#include <WiFi.h>
#include <WebServer.h>

// ====================================================================
// WiFi 热点模式 — 设备自己开 WiFi, 手机/电脑直连
// 不依赖校园网/路由器, 任何环境都能用
// ====================================================================
const char* AP_SSID = "M5Stick_Weather";
const char* AP_PASS = "12345678";  // 至少 8 位
WebServer server(80);
bool wifi_ok = false;
char deviceIP[16] = "0.0.0.0";
float lastTemp = NAN, lastHumid = NAN;  // 供网页服务读取

// 前向声明
static void getTimeStr(char *buf, size_t len);

// ====================================================================
// SHT30 直接 I2C 操作
// ====================================================================
#define SHT30_ADDR    0x44
#define I2C_FREQ      50000

bool sht30_found = false;
int used_sda = 32, used_scl = 33;

static bool sht30_read_raw(float &temp, float &humid) {
    Wire.beginTransmission(SHT30_ADDR);
    Wire.write(0x24); Wire.write(0x00);
    if (Wire.endTransmission(true) != 0) return false;
    delay(30);
    int n = Wire.requestFrom(SHT30_ADDR, 6);
    if (n < 6) return false;
    uint8_t d[6];
    for (int i = 0; i < 6; i++) d[i] = Wire.read();
    uint16_t t_raw = ((uint16_t)d[0] << 8) | d[1];
    uint16_t h_raw = ((uint16_t)d[3] << 8) | d[4];
    temp  = -45.0f + 175.0f * (float)t_raw / 65535.0f;
    humid = 100.0f * (float)h_raw / 65535.0f;
    return true;
}
static void sht30_reset() {
    Wire.beginTransmission(SHT30_ADDR);
    Wire.write(0x30); Wire.write(0xA2);
    Wire.endTransmission(true); delay(50);
}

// ====================================================================
// 固定 GPS 坐标
// ====================================================================
#define FIXED_GPS_LAT  34.821085
#define FIXED_GPS_LON  113.527073

// ====================================================================
// 日志
// ====================================================================
const unsigned long LOG_INTERVAL_MS = 30000UL;
unsigned long lastLogTime = 0;
const char* LOG_FILE = "/log.txt";
unsigned long logCount = 0, logFileSize = 0;
bool fs_ok = false;

// ====================================================================
// 页面系统 (3 页: 仪表盘/温度趋势/湿度趋势)
// ====================================================================
enum Page { PAGE_DASHBOARD = 0, PAGE_TEMPCHART = 1, PAGE_HUMICHART = 2, PAGE_COUNT = 3 };
Page currentPage = PAGE_DASHBOARD;

// ====================================================================
// 滚动图表缓冲区 (温度 + 湿度)
// ====================================================================
#define MAX_CHART_POINTS 110
float chartTemps[MAX_CHART_POINTS];
float chartHumids[MAX_CHART_POINTS];
int chartPointCount = 0;
unsigned long lastChartTime = 0;
const unsigned long CHART_INTERVAL_MS = 2000UL;

// ====================================================================
// 显示坐标
// ====================================================================
#define TITLE_Y      2
#define TIME_Y      20
#define TEMP_Y      36
#define HUMI_Y      58
#define GPS_Y       80
#define BAT_Y       100
#define LOG_Y       120

// ====================================================================
// RTC 设置
// ====================================================================
static void setRtcFromCompileTime() {
    const char* months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0}; int d, y, h, m, s;
    sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
    sscanf(__TIME__, "%d:%d:%d", &h, &m, &s);
    int month = 0; const char* p = months;
    for (int i = 1; i <= 12; i++) {
        if (strncmp(mon, p, 3) == 0) { month = i; break; } p += 3;
    }
    m5::rtc_datetime_t dt;
    dt.date.year=y; dt.date.month=month; dt.date.date=d;
    dt.time.hours=h; dt.time.minutes=m; dt.time.seconds=s;
    M5.Rtc.setDateTime(&dt);
    Serial.printf("RTC set from build: %04d-%02d-%02d %02d:%02d:%02d\n", y, month, d, h, m, s);
}

// ====================================================================
// 日志写入
// ====================================================================
static void writeLogLine(float temp, float humid) {
    if (!fs_ok) return;
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();
    File f = LittleFS.open(LOG_FILE, FILE_APPEND);
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
    f.println(line); logFileSize = f.size(); f.close();
    Serial.println(line);
}

// ====================================================================
// 网页服务
// ====================================================================
static void sendLiveHTML() {
    char t[8], h[8];
    snprintf(t, sizeof(t), "%.1f", isnan(lastTemp) ? 0.0 : lastTemp);
    snprintf(h, sizeof(h), "%.1f", isnan(lastHumid) ? 0.0 : lastHumid);
    char timeStr[24]; getTimeStr(timeStr, sizeof(timeStr));

    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta http-equiv='refresh' content='5'>"
        "<title>M5StickC Plus2</title>"
        "<style>body{font-family:sans-serif;text-align:center;margin:16px}"
        ".v{font-size:32px;margin:4px}.l{color:#888;font-size:14px}</style>"
        "</head><body>"
        "<h2>M5StickC Plus2</h2>"
        "<p style='color:#888'>" + String(timeStr) + "</p>"
        "<div class='l'>Temperature</div><div class='v'>" + String(t) + " °C</div>"
        "<div class='l'>Humidity</div><div class='v'>" + String(h) + " %</div>"
        "<div class='l'>GPS</div><div class='v'>" + String(FIXED_GPS_LAT, 6) + "N<br>" + String(FIXED_GPS_LON, 6) + "E</div>"
        "<div class='l'>Battery</div><div class='v'>" + String(M5.Power.getBatteryVoltage()/1000.0f, 2) + " V</div>"
        "<div class='l'>Log</div><div>" + String(logCount) + " lines (" + String(logFileSize) + "B)</div>"
        "<p><a href='/log'>[Download Log CSV]</a></p>"
        "<p><a href='/api/data'>[JSON Data]</a></p>"
        "</body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}
static void sendLogFile() {
    if (!fs_ok) { server.send(503, "text/plain", "FS unavailable"); return; }
    File f = LittleFS.open(LOG_FILE, FILE_READ);
    if (!f) { server.send(404, "text/plain", "No log yet"); return; }
    server.streamFile(f, "text/csv");
    f.close();
}
static void sendJSON() {
    char buf[256];
    char ts[24]; getTimeStr(ts, sizeof(ts));
    float t = isnan(lastTemp) ? -99 : lastTemp;
    float h = isnan(lastHumid) ? -99 : lastHumid;
    snprintf(buf, sizeof(buf),
        "{\"time\":\"%s\",\"temp\":%.1f,\"humid\":%.1f,"
        "\"gps_lat\":%.6f,\"gps_lon\":%.6f,"
        "\"bat_v\":%.2f,\"log_lines\":%lu,\"log_bytes\":%lu}",
        ts, t, h, FIXED_GPS_LAT, FIXED_GPS_LON,
        M5.Power.getBatteryVoltage()/1000.0f, logCount, logFileSize);
    server.send(200, "application/json", buf);
}

// ====================================================================
// 串口命令
// ====================================================================
static void handleSerialCommand() {
    if (Serial.available() <= 0) return;
    char cmd = Serial.read();
    if (cmd == 'd' || cmd == 'D') {
        if (!fs_ok) { Serial.println("FS not available"); return; }
        File f = LittleFS.open(LOG_FILE, FILE_READ);
        if (!f) { Serial.println("No log file yet"); return; }
        Serial.printf("--- LOG DUMP (%lu bytes) ---\n", f.size());
        while (f.available()) Serial.write(f.read());
        Serial.println("\n--- END ---"); f.close();
    } else if (cmd == 'c' || cmd == 'C') {
        if (fs_ok) { LittleFS.remove(LOG_FILE); logCount = 0; logFileSize = 0; Serial.println("Log cleared"); }
    } else if (cmd == 'i' || cmd == 'I') {
        Serial.printf("AP: %s | IP: %s | Pass: %s\n", AP_SSID, deviceIP, AP_PASS);
    }
}

// ====================================================================
// 图表数据收集 (每 2s 存温度和湿度)
// ====================================================================
static void addChartPoint(float temp, float humid) {
    if (chartPointCount < MAX_CHART_POINTS) {
        chartTemps[chartPointCount] = temp;
        chartHumids[chartPointCount] = humid;
        chartPointCount++;
    } else {
        memmove(chartTemps, chartTemps + 1, (MAX_CHART_POINTS - 1) * sizeof(float));
        memmove(chartHumids, chartHumids + 1, (MAX_CHART_POINTS - 1) * sizeof(float));
        chartTemps[MAX_CHART_POINTS - 1] = temp;
        chartHumids[MAX_CHART_POINTS - 1] = humid;
    }
}

// ====================================================================
// SHT30 带重试
// ====================================================================
static bool readSHT30(float &temp, float &humid) {
    if (!sht30_found) return false;
    for (int i = 0; i < 5; i++) { if (sht30_read_raw(temp, humid)) return true; delay(50); }
    return false;
}

// ====================================================================
// 时间字符串
// ====================================================================
static void getTimeStr(char *buf, size_t len) {
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();
    if (now.date.year >= 2025 && now.date.year <= 2099)
        snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
                 now.date.year, now.date.month, now.date.date,
                 now.time.hours, now.time.minutes, now.time.seconds);
    else {
        unsigned long ms = millis()/1000;
        snprintf(buf, len, "UP %02lum%02lus", ms/60, ms%60);
    }
}

// ====================================================================
// 仪表盘 (不再在 fullInit 里重复画数据区, 全部由外层统一绘制)
// ====================================================================
static void drawDashboard(float temp, float humid, float batVol, bool fullInit) {
    char buf[32];
    char timeStr[24];
    getTimeStr(timeStr, sizeof(timeStr));

    if (fullInit) {
        M5.Display.fillScreen(BLACK);
        M5.Display.setTextColor(ORANGE);
        M5.Display.setCursor(10, TITLE_Y);
        M5.Display.print("M5StickC Plus2");
    }

    // 日期时间
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", timeStr);

    // 温度 (size 2)
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.fillRect(10, TEMP_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, TEMP_Y);
    snprintf(buf, sizeof(buf), !isnan(temp) ? "Temp: %.1f C  " : "Temp: --.- C  ", temp);
    M5.Display.print(buf);

    // 湿度 (size 2)
    M5.Display.fillRect(10, HUMI_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, HUMI_Y);
    snprintf(buf, sizeof(buf), !isnan(humid) ? "Humi: %.1f %%  " : "Humi: --.- %%  ", humid);
    M5.Display.print(buf);

    // GPS (size 1.8)
    M5.Display.fillRect(10, GPS_Y, 220, 16, BLACK);
    M5.Display.setTextSize(1.8);
    M5.Display.setTextColor(YELLOW, BLACK);
    M5.Display.setCursor(10, GPS_Y);
    snprintf(buf, sizeof(buf), "%.6fN %.6fE  ", FIXED_GPS_LAT, FIXED_GPS_LON);
    M5.Display.print(buf);

    // 电池 (size 2)
    M5.Display.fillRect(10, BAT_Y, 220, 18, BLACK);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(GREEN, BLACK);
    M5.Display.setCursor(10, BAT_Y);
    M5.Display.printf("BAT: %.2fV  ", batVol);

    // log 状态行由 loop 单独更新, 此处不画
}

// ====================================================================
// 通用折线图 (温度/湿度复用)
// ====================================================================
static void drawLineChart(const char *title, uint16_t titleColor,
                          float *data, const char *unit,
                          float currentVal) {
    char buf[32];
    M5.Display.fillScreen(BLACK);

    char timeStr[24]; getTimeStr(timeStr, sizeof(timeStr));

    M5.Display.setTextColor(titleColor);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print(title);

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", timeStr);
    M5.Display.setTextSize(2);

    if (chartPointCount < 2) {
        M5.Display.setTextColor(DARKGREY);
        M5.Display.setCursor(50, 65);
        M5.Display.print("Collecting...");
        M5.Display.setTextSize(1);
        M5.Display.setCursor(65, 90);
        M5.Display.print("(need 2+ points)");
        return;
    }

    const int CX = 10, CY = 34, CW = 220, CH = 76;
    int start = 0, count = chartPointCount;
    if (chartPointCount > MAX_CHART_POINTS) {
        start = chartPointCount - MAX_CHART_POINTS;
        count = MAX_CHART_POINTS;
    }

    float dMin = 999, dMax = -999;
    for (int i = start; i < start + count; i++) {
        if (!isnan(data[i])) {
            if (data[i] < dMin) dMin = data[i];
            if (data[i] > dMax) dMax = data[i];
        }
    }
    if (dMin > dMax) return;

    float range = dMax - dMin;
    if (range < 1.0f) range = 1.0f;
    dMin -= range * 0.1f; dMax += range * 0.1f; range = dMax - dMin;

    M5.Display.drawRect(CX - 1, CY - 1, CW + 2, CH + 2, DARKGREY);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(DARKGREY);
    for (int row = 0; row <= 4; row++) {
        int yy = CY + row * CH / 4;
        float val = dMax - row * range / 4;
        snprintf(buf, sizeof(buf), "%.0f", val);
        M5.Display.setCursor(0, yy - 3); M5.Display.print(buf);
        M5.Display.drawLine(CX, yy, CX + CW - 1, yy, 0x2117);
    }

    // 折线
    for (int i = start + 1; i < start + count; i++) {
        if (isnan(data[i]) || isnan(data[i-1])) continue;
        int x1 = CX + (i-1-start) * CW / (count-1);
        int y1 = CY + CH - (int)((data[i-1] - dMin) * CH / range);
        int x2 = CX + (i-start) * CW / (count-1);
        int y2 = CY + CH - (int)((data[i] - dMin) * CH / range);
        M5.Display.drawLine(x1, y1, x2, y2, titleColor);
    }

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(GREEN);
    snprintf(buf, sizeof(buf), "Min:%.1f%s", dMin + range*0.1f, unit);
    M5.Display.setCursor(CX, CY + CH + 4); M5.Display.print(buf);

    M5.Display.setTextColor(YELLOW);
    snprintf(buf, sizeof(buf), "Max:%.1f%s", dMax - range*0.1f, unit);
    M5.Display.setCursor(CX + 100, CY + CH + 4); M5.Display.print(buf);

    M5.Display.setTextColor(DARKGREY);
    snprintf(buf, sizeof(buf), "%dpts", count);
    M5.Display.setCursor(CX + 180, CY + CH + 4); M5.Display.print(buf);
}

// ====================================================================
// Setup
// ====================================================================
static void showDiag(const char* msg, int row) {
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TEMP_Y + row * 18);
    M5.Display.setTextSize(1);
    M5.Display.print("                   ");
    M5.Display.setCursor(10, TEMP_Y + row * 18);
    M5.Display.print(msg);
    M5.Display.setTextSize(2);
}

void setup() {
    auto cfg = M5.config(); M5.begin(cfg);
    M5.Display.setRotation(1); M5.Display.setBrightness(255);
    M5.Display.setTextSize(2); M5.Display.fillScreen(BLACK);
    M5.Display.setTextColor(ORANGE);
    M5.Display.setCursor(10, TITLE_Y); M5.Display.print("M5StickC Plus2");

    static const int pinTrials[][2] = {{32,33},{0,26},{21,22}};
    sht30_found = false; char dbg[64];
    for (int t = 0; t < 3 && !sht30_found; t++) {
        used_sda = pinTrials[t][0]; used_scl = pinTrials[t][1];
        snprintf(dbg, sizeof(dbg), "Try SDA=%d SCL=%d", used_sda, used_scl);
        showDiag(dbg, 0);
        Wire.begin(used_sda, used_scl, I2C_FREQ); delay(10);
        Wire.beginTransmission(SHT30_ADDR);
        if (Wire.endTransmission(true) == 0) {
            sht30_found = true; sht30_reset();
            float dummy_t, dummy_h;
            for (int r = 0; r < 3; r++) { if (sht30_read_raw(dummy_t, dummy_h)) break; delay(50); }
            snprintf(dbg, sizeof(dbg), "SHT30@0x%02x Pins:%d/%d", SHT30_ADDR, used_sda, used_scl);
            showDiag(dbg, 1);
        }
    }
    if (!sht30_found) {
        showDiag("SHT30: NOT FOUND!", 1);
        for (int t = 0; t < 3; t++) {
            int sda = pinTrials[t][0], scl = pinTrials[t][1];
            Wire.begin(sda, scl, I2C_FREQ); delay(10);
            for (int addr = 3; addr < 0x78; addr++) {
                Wire.beginTransmission(addr);
                if (Wire.endTransmission(true) == 0) {
                    snprintf(dbg, sizeof(dbg), "I2C 0x%02x@%d/%d", addr, sda, scl);
                    showDiag(dbg, 2);
                    Serial.printf("I2C: 0x%02x on SDA=%d SCL=%d\n", addr, sda, scl);
                    delay(800);
                }
            }
        }
        showDiag("Check wiring", 3); delay(2000);
    } else showDiag("SHT30 OK", 2);

    m5::rtc_datetime_t rtc_now = M5.Rtc.getDateTime();
    if (rtc_now.date.year < 2025 || rtc_now.date.year > 2035) { setRtcFromCompileTime(); }

    fs_ok = LittleFS.begin();
    if (!fs_ok) { LittleFS.format(); fs_ok = LittleFS.begin(); }
    if (fs_ok) {
        File f = LittleFS.open(LOG_FILE, FILE_READ);
        if (f) { while (f.available()) { if (f.read() == '\n') logCount++; } logFileSize = f.size(); f.close(); }
    }
    Serial.printf("LittleFS: %s, log %lu lines\n", fs_ok ? "OK" : "FAIL", logCount);

    // ---- WiFi 热点 ----
    showDiag("Starting AP...", 3);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(500);
    wifi_ok = true;
    strncpy(deviceIP, WiFi.softAPIP().toString().c_str(), sizeof(deviceIP) - 1);
    Serial.printf("AP: %s | IP: %s | Pass: %s\n", AP_SSID, deviceIP, AP_PASS);
    showDiag(deviceIP, 3);
    server.on("/", sendLiveHTML);
    server.on("/log", sendLogFile);
    server.on("/api/data", sendJSON);
    server.begin();

    // 初始仪表盘
    M5.Display.fillScreen(BLACK);
    M5.Display.setTextColor(ORANGE);
    M5.Display.setCursor(10, TITLE_Y); M5.Display.print("M5StickC Plus2");
    char timeStr[24]; getTimeStr(timeStr, sizeof(timeStr));
    M5.Display.setTextSize(1); M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y); M5.Display.printf("%-22s", timeStr);
    M5.Display.setTextSize(2);
    M5.Display.fillRect(10, TEMP_Y, 220, 18, BLACK);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TEMP_Y); M5.Display.print("Temp: --.- C  ");
    M5.Display.fillRect(10, HUMI_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, HUMI_Y); M5.Display.print("Humi: --.- %  ");
    M5.Display.fillRect(10, GPS_Y, 220, 16, BLACK);
    M5.Display.setTextSize(1.8); M5.Display.setTextColor(YELLOW, BLACK);
    M5.Display.setCursor(10, GPS_Y); M5.Display.printf("%.6fN %.6fE  ", FIXED_GPS_LAT, FIXED_GPS_LON);
    M5.Display.setTextSize(2); M5.Display.setTextColor(GREEN, BLACK);
    M5.Display.fillRect(10, BAT_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, BAT_Y); M5.Display.print("BAT: --.--V  ");
    M5.Display.fillRect(10, LOG_Y, 220, 18, BLACK);
    M5.Display.setTextColor(CYAN, BLACK);
    M5.Display.setCursor(10, LOG_Y); M5.Display.printf("Log: %lu lines", logCount);

    Serial.println("--- System Ready ---");
    Serial.println("Commands: d=dump log, c=clear log");
}

// ====================================================================
// Loop
// ====================================================================
void loop() {
    M5.update();
    handleSerialCommand();
    if (wifi_ok) server.handleClient();

    float temp = NAN, humid = NAN;
    readSHT30(temp, humid);
    if (!isnan(temp)) lastTemp = temp;
    if (!isnan(humid)) lastHumid = humid;
    float batVol = M5.Power.getBatteryVoltage() / 1000.0f;

    // BtnA: 0 → 1 → 2 → 0
    if (M5.BtnA.wasPressed())
        currentPage = (Page)((currentPage + 1) % PAGE_COUNT);

    unsigned long now = millis();

    // 每 2s 收集图表数据
    if (now - lastChartTime >= CHART_INTERVAL_MS) {
        lastChartTime = now;
        if (!isnan(temp) && !isnan(humid))
            addChartPoint(temp, humid);
    }

    // 页面渲染
    if (currentPage == PAGE_DASHBOARD) {
        drawDashboard(temp, humid, batVol, true);
        // log 状态行由下方统一更新
    } else if (currentPage == PAGE_TEMPCHART) {
        drawLineChart("Temp Trend", CYAN, chartTemps, "C", temp);
    } else {
        drawLineChart("Humi Trend", YELLOW, chartHumids, "%", humid);
    }

    // 日志 (仪表盘页更新显示)
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        if (!isnan(temp) && !isnan(humid)) {
            writeLogLine(temp, humid);
            logCount++;
        }
        if (currentPage == PAGE_DASHBOARD) {
            M5.Display.fillRect(10, LOG_Y, 220, 18, BLACK);
            M5.Display.setTextColor(CYAN, BLACK);
            M5.Display.setCursor(10, LOG_Y);
            M5.Display.printf("Log: %lu (%luB)", logCount, logFileSize);
        }
    }

    delay(200);
}
