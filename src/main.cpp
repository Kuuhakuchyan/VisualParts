#include <M5Unified.h>
#include <LittleFS.h>
#include <time.h>

// ====================================================================
// SHT30 直接 I2C 操作
// ENV III: SHT30 @ 0x44 + QMP6988 @ 0x70, Grove 口连接
// ====================================================================
#define SHT30_ADDR    0x44
#define I2C_FREQ      50000

bool sht30_found = false;
int used_sda = 32, used_scl = 33;

static bool sht30_read_raw(float &temp, float &humid) {
    Wire.beginTransmission(SHT30_ADDR);
    Wire.write(0x24);
    Wire.write(0x00);
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
    Wire.write(0x30);
    Wire.write(0xA2);
    Wire.endTransmission(true);
    delay(50);
}

// ====================================================================
// 固定 GPS 坐标
// ====================================================================
#define FIXED_GPS_LAT  34.821085
#define FIXED_GPS_LON  113.527073

// ====================================================================
// 日志配置
// ====================================================================
const unsigned long LOG_INTERVAL_MS = 30000UL;
unsigned long lastLogTime = 0;
const char* LOG_FILE = "/log.txt";
unsigned long logCount = 0;
unsigned long logFileSize = 0;
bool fs_ok = false;

// ====================================================================
// 页面系统
// ====================================================================
enum Page { PAGE_DASHBOARD = 0, PAGE_CHART = 1 };
Page currentPage = PAGE_DASHBOARD;
Page lastPage = PAGE_DASHBOARD;

// ====================================================================
// 滚动图表缓冲区
// ====================================================================
#define MAX_CHART_POINTS 110
float chartTemps[MAX_CHART_POINTS];
int chartPointCount = 0;
unsigned long lastChartTime = 0;
const unsigned long CHART_INTERVAL_MS = 2000UL;

// ====================================================================
// 显示坐标
// ====================================================================
#define TITLE_Y      2
#define TIME_Y      20    // 日期时间 (在标题下方)
#define TEMP_Y      36
#define HUMI_Y      58
#define GPS_Y       80
#define BAT_Y       100
#define LOG_Y       120

// ====================================================================
// 工具函数：用编译时间初始化 RTC
// ====================================================================
static void setRtcFromCompileTime() {
    const char* months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0};
    int d, y, h, m, s;
    sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
    sscanf(__TIME__, "%d:%d:%d", &h, &m, &s);

    int month = 0;
    const char* p = months;
    for (int i = 1; i <= 12; i++) {
        if (strncmp(mon, p, 3) == 0) { month = i; break; }
        p += 3;
    }

    m5::rtc_datetime_t dt;
    dt.date.year  = y;
    dt.date.month = month;
    dt.date.date  = d;
    dt.time.hours   = h;
    dt.time.minutes = m;
    dt.time.seconds = s;
    M5.Rtc.setDateTime(&dt);

    Serial.printf("RTC set from build: %04d-%02d-%02d %02d:%02d:%02d\n",
                  y, month, d, h, m, s);
}

// ====================================================================
// 日志写入
// ====================================================================
static void writeLogLine(float temp, float humid) {
    if (!fs_ok) return;

    m5::rtc_datetime_t now = M5.Rtc.getDateTime();

    File f = LittleFS.open(LOG_FILE, FILE_APPEND);
    if (!f) {
        Serial.println("Log: open failed");
        return;
    }

    if (f.size() == 0) {
        f.println("datetime,temp_c,humidity_pct,gps_lat,gps_lon");
    }

    // 如果 RTC 年份不对，用上位时间戳
    char line[128];
    if (now.date.year >= 2025) {
        snprintf(line, sizeof(line),
                 "%04d-%02d-%02d %02d:%02d:%02d,%.1f,%.1f,%.6f,%.6f",
                 now.date.year, now.date.month, now.date.date,
                 now.time.hours, now.time.minutes, now.time.seconds,
                 temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
    } else {
        // RTC 未设置时用 millis() 替代
        unsigned long ms = millis() / 1000;
        snprintf(line, sizeof(line),
                 "1970-01-01 00:%02lu:%02lu,%.1f,%.1f,%.6f,%.6f",
                 ms / 60, ms % 60,
                 temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON);
    }

    f.println(line);
    logFileSize = f.size();
    f.close();
    Serial.print("LOG: ");
    Serial.println(line);
}

// ====================================================================
// 串口命令处理: 输入 'd' 或 'dump' 打印日志
// ====================================================================
static void handleSerialCommand() {
    if (Serial.available() <= 0) return;

    char cmd = Serial.read();
    if (cmd == 'd' || cmd == 'D') {
        if (!fs_ok) {
            Serial.println("FS not available");
            return;
        }
        File f = LittleFS.open(LOG_FILE, FILE_READ);
        if (!f) {
            Serial.println("No log file yet");
            return;
        }
        Serial.printf("--- LOG DUMP (%lu bytes) ---\n", f.size());
        while (f.available()) {
            Serial.write(f.read());
        }
        Serial.println("\n--- END ---");
        f.close();
    } else if (cmd == 'c' || cmd == 'C') {
        if (fs_ok) {
            LittleFS.remove(LOG_FILE);
            logCount = 0;
            logFileSize = 0;
            Serial.println("Log cleared");
        }
    }
}

// ====================================================================
// 图表
// ====================================================================
static void addChartPoint(float temp) {
    if (chartPointCount < MAX_CHART_POINTS) {
        chartTemps[chartPointCount++] = temp;
    } else {
        memmove(chartTemps, chartTemps + 1, (MAX_CHART_POINTS - 1) * sizeof(float));
        chartTemps[MAX_CHART_POINTS - 1] = temp;
    }
}

// ====================================================================
// SHT30 带重试的读取
// ====================================================================
static bool readSHT30(float &temp, float &humid) {
    if (!sht30_found) return false;
    for (int i = 0; i < 5; i++) {
        if (sht30_read_raw(temp, humid)) return true;
        delay(50);
    }
    return false;
}

// ====================================================================
// 获取 RTC 时间字符串
// ====================================================================
static void getTimeStr(char *buf, size_t len) {
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();
    if (now.date.year >= 2025 && now.date.year <= 2099) {
        snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
                 now.date.year, now.date.month, now.date.date,
                 now.time.hours, now.time.minutes, now.time.seconds);
    } else {
        unsigned long ms = millis() / 1000;
        snprintf(buf, len, "UP %02lum%02lus", ms / 60, ms % 60);
    }
}

// ====================================================================
// 仪表盘
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
        M5.Display.setTextSize(2);

        M5.Display.setTextColor(WHITE, BLACK);
        M5.Display.setCursor(10, TEMP_Y);
        M5.Display.print("Temp: --.- C  ");
        M5.Display.setCursor(10, HUMI_Y);
        M5.Display.print("Humi: --.- %  ");
        M5.Display.setTextSize(1.8);
        M5.Display.setTextColor(YELLOW, BLACK);
        M5.Display.setCursor(10, GPS_Y);
        M5.Display.printf("%.6fN %.6fE", FIXED_GPS_LAT, FIXED_GPS_LON);
        M5.Display.setTextSize(2);
        M5.Display.setTextColor(CYAN, BLACK);
        M5.Display.setCursor(10, LOG_Y);
        if (fs_ok) {
            M5.Display.print("Log: Ready    ");
        } else {
            M5.Display.setTextColor(RED, BLACK);
            M5.Display.print("Log: NO FS    ");
        }
    }

    // 日期时间行 (每次刷新)
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    snprintf(buf, sizeof(buf), "%-20s", timeStr);  // 左对齐，清行
    M5.Display.print(buf);

    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TEMP_Y);
    if (!isnan(temp)) {
        snprintf(buf, sizeof(buf), "Temp: %.1f C  ", temp);
    } else {
        snprintf(buf, sizeof(buf), "Temp: --.- C  ");
    }
    M5.Display.print(buf);

    M5.Display.setCursor(10, HUMI_Y);
    if (!isnan(humid)) {
        snprintf(buf, sizeof(buf), "Humi: %.1f %%  ", humid);
    } else {
        snprintf(buf, sizeof(buf), "Humi: --.- %%  ");
    }
    M5.Display.print(buf);

    M5.Display.setTextSize(1.8);
    M5.Display.setTextColor(YELLOW, BLACK);
    M5.Display.setCursor(10, GPS_Y);
    snprintf(buf, sizeof(buf), "%.6fN %.6fE  ", FIXED_GPS_LAT, FIXED_GPS_LON);
    M5.Display.print(buf);
    M5.Display.setTextSize(2);

    M5.Display.setTextColor(GREEN, BLACK);
    M5.Display.setCursor(10, BAT_Y);
    M5.Display.printf("BAT: %.2fV  ", batVol);
}

// ====================================================================
// 温度趋势图
// ====================================================================
static void drawChartPage(float currentTemp) {
    char buf[32];
    M5.Display.fillScreen(BLACK);

    char timeStr[24];
    getTimeStr(timeStr, sizeof(timeStr));

    M5.Display.setTextColor(ORANGE);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print("Temp Trend");

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", timeStr);
    M5.Display.setTextSize(2);

    if (chartPointCount < 2) {
        M5.Display.setTextColor(DARKGREY);
        M5.Display.setCursor(50, 65);
        M5.Display.setTextSize(2);
        M5.Display.print("Collecting...");
        M5.Display.setTextSize(1);
        M5.Display.setCursor(65, 90);
        M5.Display.print("(need 2+ points)");
        M5.Display.setTextSize(2);
        return;
    }

    const int CX = 10, CY = 34, CW = 220, CH = 76;

    int start = 0;
    int count = chartPointCount;
    if (chartPointCount > MAX_CHART_POINTS) {
        start = chartPointCount - MAX_CHART_POINTS;
        count = MAX_CHART_POINTS;
    }

    float tMin = 99, tMax = -99;
    for (int i = start; i < start + count; i++) {
        if (!isnan(chartTemps[i])) {
            if (chartTemps[i] < tMin) tMin = chartTemps[i];
            if (chartTemps[i] > tMax) tMax = chartTemps[i];
        }
    }
    if (tMin > tMax) return;

    float range = tMax - tMin;
    if (range < 1.0f) range = 1.0f;
    tMin -= range * 0.1f;
    tMax += range * 0.1f;
    range = tMax - tMin;

    M5.Display.drawRect(CX - 1, CY - 1, CW + 2, CH + 2, DARKGREY);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(DARKGREY);
    for (int row = 0; row <= 4; row++) {
        int yy = CY + row * CH / 4;
        float val = tMax - row * range / 4;
        snprintf(buf, sizeof(buf), "%.0f", val);
        M5.Display.setCursor(0, yy - 3);
        M5.Display.print(buf);
        M5.Display.drawLine(CX, yy, CX + CW - 1, yy, 0x2117);
    }

    for (int i = start + 1; i < start + count; i++) {
        if (isnan(chartTemps[i]) || isnan(chartTemps[i - 1])) continue;
        int x1 = CX + (i - 1 - start) * CW / (count - 1);
        int y1 = CY + CH - (int)((chartTemps[i - 1] - tMin) * CH / range);
        int x2 = CX + (i - start) * CW / (count - 1);
        int y2 = CY + CH - (int)((chartTemps[i] - tMin) * CH / range);
        M5.Display.drawLine(x1, y1, x2, y2, CYAN);
    }

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(GREEN);
    snprintf(buf, sizeof(buf), "Min:%.1f", tMin + range * 0.1f);
    M5.Display.setCursor(CX, CY + CH + 4);
    M5.Display.print(buf);

    M5.Display.setTextColor(YELLOW);
    snprintf(buf, sizeof(buf), "Max:%.1f", tMax - range * 0.1f);
    M5.Display.setCursor(CX + 100, CY + CH + 4);
    M5.Display.print(buf);

    M5.Display.setTextColor(DARKGREY);
    snprintf(buf, sizeof(buf), "%dpts", count);
    M5.Display.setCursor(CX + 180, CY + CH + 4);
    M5.Display.print(buf);
    M5.Display.setTextSize(2);
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
    auto cfg = M5.config();
    M5.begin(cfg);

    M5.Display.setRotation(1);
    M5.Display.setBrightness(255);
    M5.Display.setTextSize(2);
    M5.Display.fillScreen(BLACK);

    M5.Display.setTextColor(ORANGE);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print("M5StickC Plus2");

    // ---- I2C + SHT30 ----
    static const int pinTrials[][2] = {{32,33},{0,26},{21,22}};
    sht30_found = false;
    char dbg[64];

    for (int t = 0; t < 3 && !sht30_found; t++) {
        used_sda = pinTrials[t][0];
        used_scl = pinTrials[t][1];
        snprintf(dbg, sizeof(dbg), "Try SDA=%d SCL=%d", used_sda, used_scl);
        showDiag(dbg, 0);
        Wire.begin(used_sda, used_scl, I2C_FREQ);
        delay(10);
        Wire.beginTransmission(SHT30_ADDR);
        if (Wire.endTransmission(true) == 0) {
            sht30_found = true;
            sht30_reset();
            float dummy_t, dummy_h;
            for (int r = 0; r < 3; r++) {
                if (sht30_read_raw(dummy_t, dummy_h)) break;
                delay(50);
            }
            snprintf(dbg, sizeof(dbg), "SHT30@0x%02x Pins:%d/%d",
                     SHT30_ADDR, used_sda, used_scl);
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
        showDiag("Check wiring", 3);
        delay(2000);
    } else {
        showDiag("SHT30 OK", 2);
        delay(300);
    }

    // ---- RTC ----
    m5::rtc_datetime_t rtc_now = M5.Rtc.getDateTime();
    if (rtc_now.date.year < 2025 || rtc_now.date.year > 2035) {
        Serial.println("RTC invalid, setting from compile time...");
        setRtcFromCompileTime();
    }
    Serial.println("RTC: OK");

    // ---- LittleFS ----
    fs_ok = LittleFS.begin();
    if (!fs_ok) {
        Serial.println("FS: mount failed, formatting...");
        LittleFS.format();
        fs_ok = LittleFS.begin();
    }
    if (fs_ok) {
        // 检查已有日志文件行数
        File f = LittleFS.open(LOG_FILE, FILE_READ);
        if (f) {
            while (f.available()) {
                char c = f.read();
                if (c == '\n') logCount++;
            }
            logFileSize = f.size();
            f.close();
        }
    }
    Serial.printf("LittleFS: %s, log %lu lines\n", fs_ok ? "OK" : "FAIL", logCount);

    // ---- 初始仪表盘 ----
    M5.Display.fillScreen(BLACK);
    M5.Display.setTextColor(ORANGE);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print("M5StickC Plus2");

    char timeStr[24];
    getTimeStr(timeStr, sizeof(timeStr));
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", timeStr);
    M5.Display.setTextSize(2);

    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TEMP_Y);
    M5.Display.print("Temp: --.- C  ");
    M5.Display.setCursor(10, HUMI_Y);
    M5.Display.print("Humi: --.- %  ");
    M5.Display.setTextSize(1.8);
    M5.Display.setTextColor(YELLOW, BLACK);
    M5.Display.setCursor(10, GPS_Y);
    M5.Display.printf("%.6fN %.6fE  ", FIXED_GPS_LAT, FIXED_GPS_LON);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(GREEN, BLACK);
    M5.Display.setCursor(10, BAT_Y);
    M5.Display.print("BAT: --.--V  ");
    M5.Display.setTextColor(CYAN, BLACK);
    M5.Display.setCursor(10, LOG_Y);
    if (fs_ok) {
        M5.Display.printf("Log: %lu lines", logCount);
    } else {
        M5.Display.setTextColor(RED, BLACK);
        M5.Display.print("Log: NO FS");
    }

    Serial.println("--- System Ready ---");
    Serial.println("Commands: d=dump log, c=clear log");
}

// ====================================================================
// Loop
// ====================================================================
void loop() {
    M5.update();

    // 串口命令
    handleSerialCommand();

    float temp = NAN, humid = NAN;
    readSHT30(temp, humid);

    float batVol = M5.Power.getBatteryVoltage() / 1000.0f;

    if (M5.BtnA.wasPressed()) {
        lastPage = currentPage;
        currentPage = (Page)((currentPage + 1) % 2);
    }

    unsigned long now = millis();

    if (currentPage == PAGE_DASHBOARD) {
        if (lastPage != currentPage) {
            drawDashboard(temp, humid, batVol, true);
            lastPage = currentPage;
        } else {
            drawDashboard(temp, humid, batVol, false);
        }
    } else {
        if (now - lastChartTime >= CHART_INTERVAL_MS) {
            lastChartTime = now;
            if (!isnan(temp)) addChartPoint(temp);
        }
        drawChartPage(temp);
    }

    if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;

        if (!isnan(temp) && !isnan(humid)) {
            writeLogLine(temp, humid);
            logCount++;
            if (currentPage == PAGE_DASHBOARD) {
                M5.Display.setTextColor(CYAN, BLACK);
                M5.Display.setCursor(10, LOG_Y);
                M5.Display.printf("Log: %lu (%luB)", logCount, logFileSize);
            }
        } else if (currentPage == PAGE_DASHBOARD) {
            M5.Display.setTextColor(RED, BLACK);
            M5.Display.setCursor(10, LOG_Y);
            M5.Display.print("Log: Err Read  ");
        }
    }

    delay(200);
}

