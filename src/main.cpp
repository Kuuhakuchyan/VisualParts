#include <M5Unified.h>
#include <LittleFS.h>
#include <time.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

// ====================================================================
// WiFi STA — 连接本地 WiFi/校园网, 自主推送数据到服务器
// ====================================================================
// 校园网网页认证配置:
//   1. 设备先连上校园网 WiFi (通常不需要密码或 WPA2)
//   2. 然后 POST 学号/密码到认证页面
//   3. 登录成功后即可发送 HTTP 请求到你的服务器
//
// 在你自己的服务器上搭建接收端:
//   POST http://<server>/api/upload
//   Content-Type: application/json
//   Body: {"temp":25.3,"humid":60.2,"gps":"34.821N 113.527E","bat":4.12,"time":"..."}
//   Response: {"status":"ok"}
// ====================================================================
const char* STA_SSID  = "";              // 校园网 WiFi 名称
const char* STA_PASS  = "";              // WiFi 密码 (没有就留空)
const char* STA_USER  = "";              // 学号 (校园网认证用)
const char* STA_PWD   = "";              // 密码 (校园网认证用)
const char* LOGIN_URL = "";              // 认证页面地址
const char* SERVER_URL = "http://192.168.1.100:8080"; // 你的服务器

bool sta_ok = false;
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL_MS = 30000UL;

// ====================================================================
// WiFi 热点 (保留, 供直接连接查看)
// ====================================================================
const char* AP_SSID = "M5Stick_Weather";
const char* AP_PASS = "Dsrdd159987@";
WebServer server(80);
DNSServer dnsServer;
bool wifi_ok = false;
char deviceIP[16] = "0.0.0.0";
float lastTemp = NAN, lastHumid = NAN;

// ====================================================================
// BLE 蓝牙 — 手机通过蓝牙收数据, 用自己的网络发到服务器
// 绕过校园网网页认证, 手机 BLE 收到后自动 HTTP POST 到你的服务器
//
// 接收端推荐:
//   Android: nRF Connect / Serial Bluetooth Terminal
//   iOS: nRF Connect / LightBlue
// 自动转发: Android 用 MacroDroid, iOS 用 Bluefy/Shortcuts
// ====================================================================
#define BLE_DEVICE_NAME "M5Stick_Weather"
static BLEServer*         bleServer   = nullptr;
static BLECharacteristic* bleTxChar   = nullptr;
static bool               bleConnected = false;

static void bleSend(const char* data);

class BleCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* s)    { bleConnected = true;  Serial.println("BLE connected"); }
    void onDisconnect(BLEServer* s) { bleConnected = false; Serial.println("BLE disconnected");
        bleServer->startAdvertising(); }
};

// ====================================================================
// 日志: 每日自动归档, 存储管理
// ====================================================================
const unsigned long LOG_INTERVAL_MS = 30000UL;
unsigned long lastLogTime = 0;
unsigned long logCount = 0, logFileSize = 0;
bool fs_ok = false;
char currentLogFile[32] = "/log.txt";
int  lastLogDay = 0;

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

// 前向声明
static void getTimeStr(char *buf, size_t len);

// ====================================================================
// SHT30 直接 I2C 操作
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
// 日志写入 (每日自动归档)
// ====================================================================
static void manageStorage();

static void writeLogLine(float temp, float humid) {
    if (!fs_ok) return;
    m5::rtc_datetime_t now = M5.Rtc.getDateTime();

    // 检测日期变更 → 自动旋转到新文件
    if (now.date.year >= 2025 && now.date.date != lastLogDay) {
        lastLogDay = now.date.date;
        snprintf(currentLogFile, sizeof(currentLogFile),
                 "/log_%04d%02d%02d.csv", now.date.year, now.date.month, now.date.date);
        logCount = 0;
    }

    File f = LittleFS.open(currentLogFile, FILE_APPEND);
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
    logCount++;
    Serial.println(line);
    manageStorage();
}

// ====================================================================
// 存储管理: 保留最近 14 天或 1MB 以内
// ====================================================================
static void manageStorage() {
    static unsigned long lastCheck = 0;
    unsigned long now = millis();
    if (now - lastCheck < 60000) return;
    lastCheck = now;

    struct LF { char name[32]; unsigned long size; };
    LF files[50]; int n = 0; unsigned long total = 0;

    File root = LittleFS.open("/");
    if (!root || !root.isDirectory()) return;
    File f = root.openNextFile();
    while (f && n < 50) {
        String s = f.name();
        if (s.startsWith("log_")) {
            strncpy(files[n].name, s.c_str(), 31);
            total += (files[n].size = f.size());
            n++;
        }
        f.close(); f = root.openNextFile();
    }
    root.close();

    if (n <= 5 && total < 1048576) return;

    // 按文件名排序 (日期序)
    for (int i = 0; i < n-1; i++)
        for (int j = i+1; j < n; j++)
            if (strcmp(files[i].name, files[j].name) > 0) {
                LF t = files[i]; files[i] = files[j]; files[j] = t;
            }

    // 保留最近 14 天或 1MB
    int keep = n;
    for (unsigned long acc = 0, i = n-1; i >= 0 && i < n; i--) {
        acc += files[i].size;
        if (acc > 1048576 && i > 0) { keep = n - i; break; }
    }
    if (keep > 14) keep = 14;
    for (int i = 0; i < n - keep; i++) {
        LittleFS.remove(files[i].name);
        Serial.printf("Clean: removed %s\n", files[i].name);
    }
}

// ====================================================================
// BLE 初始化与发送
// ====================================================================
static void initBLE() {
    BLEDevice::init(BLE_DEVICE_NAME);
    BLEDevice::setPower(ESP_PWR_LVL_P9);  // 最大发射功率

    bleServer = BLEDevice::createServer();
    bleServer->setCallbacks(new BleCallbacks());

    // 标准 UART 服务 (Nordic UART Service)
    BLEService* svc = bleServer->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    bleTxChar = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_NOTIFY);
    bleTxChar->addDescriptor(new BLE2902());
    svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_WRITE);
    svc->start();

    // 广播配置 (显式声明可连接)
    BLEAdvertising* adv = BLEDevice::getAdvertising();
    adv->addServiceUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    adv->setScanResponse(true);
    adv->setMinPreferred(0x06);  // 7.5ms 最小连接间隔
    adv->setMaxPreferred(0x0C);  // 15ms 最大连接间隔
    adv->start();

    Serial.println("BLE: " BLE_DEVICE_NAME);
}

static void bleSend(const char* data) {
    if (!bleConnected || bleTxChar == nullptr) return;
    bleTxChar->setValue((uint8_t*)data, strlen(data));
    bleTxChar->notify();
}

// ====================================================================
// WiFi STA + HTTP 推送数据到服务器
// ====================================================================
static bool staConnect() {
    if (strlen(STA_SSID) == 0) return false;
    Serial.printf("STA: connecting %s\n", STA_SSID);
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(STA_SSID, STA_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
    if (WiFi.status() != WL_CONNECTED) return false;
    Serial.printf("\nSTA: IP %s\n", WiFi.localIP().toString().c_str());

    // 校园网网页认证
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
    return true;
}
static bool httpSend(float temp, float humid, float bat) {
    if (!sta_ok || strlen(SERVER_URL) == 0) return false;
    char ts[24]; getTimeStr(ts, sizeof(ts));
    char json[256]; snprintf(json, sizeof(json),
        "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\","
        "\"bat\":%.2f,\"time\":\"%s\",\"device\":\"M5StickC_Plus2\"}",
        temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON, bat, ts);
    HTTPClient h; h.begin(String(SERVER_URL) + "/api/upload");
    h.addHeader("Content-Type", "application/json");
    int c = h.POST(json); h.end();
    return c == 200;
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
        "<title>M5StickC Plus2</title>"
        "<style>"
        "*{margin:0;padding:0;box-sizing:border-box}"
        "body{font-family:sans-serif;text-align:center;padding:12px;background:#111;color:#fff}"
        "h2{color:orange;font-size:20px}"
        ".ts{color:#888;font-size:12px;margin:4px 0 12px}"
        ".g{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}"
        ".b{background:#1a1a2e;border-radius:10px;padding:10px 16px;min-width:100px}"
        ".l{color:#888;font-size:12px}.v{font-size:28px;font-weight:bold}"
        "canvas{width:100%;max-width:440px;height:150px;background:#1a1a2e;border-radius:10px;margin:4px 0}"
        "a{color:#4fc3f7;font-size:13px}"
        "</style></head><body>"
        "<h2>M5StickC Plus2</h2>"
        "<div class='ts'>" + String(timeStr) + "</div>"
        "<div class='g'>"
        "<div class='b'><div class='l'>Temp</div><div class='v' style='color:#00e5ff'>" + String(t) + "C</div></div>"
        "<div class='b'><div class='l'>Humi</div><div class='v' style='color:#ffea00'>" + String(h) + "%</div></div>"
        "<div class='b'><div class='l'>Battery</div><div class='v' style='color:#76ff03'>" + String(M5.Power.getBatteryVoltage()/1000.0f, 2) + "V</div></div>"
        "</div>"
        "<div style='color:#888;font-size:12px;margin:8px'>"
        + String(FIXED_GPS_LAT, 6) + "N / " + String(FIXED_GPS_LON, 6) + "E &nbsp;|&nbsp; Log: " + String(logCount) + " lines"
        "</div>"
        "<canvas id='cTemp'></canvas>"
        "<canvas id='cHumi'></canvas>"
        "<div style='margin:8px'><a href='/files'>[Log Files]</a> &nbsp; <a href='/log'>[Download CSV]</a></div>"
        "<script>"
        "function draw(id,data,clr,unit){"
        "var c=document.getElementById(id),ctx=c.getContext('2d'),w=c.width=440,h=c.height=150;"
        "var P={t:15,r:10,b:22,l:36},cw=w-P.l-P.r,ch=h-P.t-P.b;"
        "ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h);"
        "if(!data||data.length<2)return;"
        "var mn=Math.min.apply(null,data),mx=Math.max.apply(null,data),rg=mx-mn||1;"
        "mn-=rg*0.1;mx+=rg*0.1;rg=mx-mn;"
        "ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.font='10px sans-serif';ctx.textAlign='right';"
        "for(var i=0;i<=4;i++){"
        "var yy=P.t+ch*i/4;"
        "ctx.beginPath();ctx.moveTo(P.l,yy);ctx.lineTo(w-P.r,yy);ctx.stroke();"
        "ctx.fillStyle='#888';ctx.fillText((mx-rg*i/4).toFixed(1),P.l-4,yy+3)}"
        "ctx.strokeStyle=clr;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();"
        "for(var i=0;i<data.length;i++){"
        "var x=P.l+i*cw/(data.length-1),y=P.t+ch-(data[i]-mn)*ch/rg;"
        "i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}"
        "ctx.stroke();"
        "ctx.fillStyle='#888';ctx.textAlign='center';ctx.font='11px sans-serif';"
        "ctx.fillText(unit,w/2,h-4)}"
        "fetch('/api/chart').then(function(r){return r.json()}).then(function(d){"
        "draw('cTemp',d.temp,'#00e5ff','Temperature (C)');"
        "draw('cHumi',d.humid,'#ffea00','Humidity (%)')});"
        "setInterval(function(){"
        "fetch('/api/chart').then(function(r){return r.json()}).then(function(d){"
        "draw('cTemp',d.temp,'#00e5ff','Temperature (C)');"
        "draw('cHumi',d.humid,'#ffea00','Humidity (%)')})"
        "},8000);"
        "</script></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}
static void sendLogFile() {
    if (!fs_ok) { server.send(503, "text/plain", "FS unavailable"); return; }
    String path = server.uri();
    if (path == "/log" || path == "/log.txt") path = String(currentLogFile);
    else if (path.startsWith("/log/")) path = "/" + path.substring(5);
    File f = LittleFS.open(path.c_str(), FILE_READ);
    if (!f) { server.send(404, "text/plain", "File not found"); return; }
    server.streamFile(f, "text/csv");
    f.close();
}
static void sendFileList() {
    if (!fs_ok) { server.send(503, "text/plain", "FS unavailable"); return; }
    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Log Files</title>"
        "<style>body{font-family:sans-serif;background:#111;color:#fff;padding:16px}"
        "a{color:#4fc3f7;display:block;padding:6px 0}"
        ".h{color:orange;font-size:18px;margin-bottom:12px}"
        ".s{color:#888;font-size:12px}</style></head><body>"
        "<div class='h'>Log Files</div>";
    File root = LittleFS.open("/");
    if (root && root.isDirectory()) {
        File f = root.openNextFile();
        while (f) {
            String name = f.name();
            if (name.startsWith("log_"))
                html += "<a href='/log/" + name + "'>" + name + " (" + String(f.size()) + "B)</a>";
            f.close(); f = root.openNextFile();
        }
        root.close();
    }
    html += "<div class='s'>Current: " + String(currentLogFile) + "</div>";
    html += "<p><a href='/'>Back</a></p></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}
static void sendChartJSON() {
    int n = chartPointCount;
    int start = n > MAX_CHART_POINTS ? n - MAX_CHART_POINTS : 0;
    int count = n > MAX_CHART_POINTS ? MAX_CHART_POINTS : n;

    String json = "{\"count\":" + String(count) + ",\"temp\":[";
    for (int i = start; i < start + count; i++) {
        if (i > start) json += ",";
        json += String(isnan(chartTemps[i]) ? 0 : chartTemps[i], 1);
    }
    json += "],\"humid\":[";
    for (int i = start; i < start + count; i++) {
        if (i > start) json += ",";
        json += String(isnan(chartHumids[i]) ? 0 : chartHumids[i], 1);
    }
    json += "]}";
    server.send(200, "application/json", json);
}

// ====================================================================
// 串口命令
// ====================================================================
static void handleSerialCommand() {
    if (Serial.available() <= 0) return;
    char cmd = Serial.read();
    if (cmd == 'd' || cmd == 'D') {
        if (!fs_ok) { Serial.println("FS not available"); return; }
        File f = LittleFS.open(currentLogFile, FILE_READ);
        if (!f) { Serial.println("No log file yet"); return; }
        Serial.printf("--- LOG DUMP (%lu bytes) ---\n", f.size());
        while (f.available()) Serial.write(f.read());
        Serial.println("\n--- END ---"); f.close();
    } else if (cmd == 'c' || cmd == 'C') {
        if (fs_ok) { LittleFS.remove(currentLogFile); logCount = 0; logFileSize = 0; Serial.println("Log cleared"); }
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
        File f = LittleFS.open(currentLogFile, FILE_READ);
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
    // DNS 劫持: 所有域名都指向设备 IP → 手机连接后弹页面
    dnsServer.start(53, "*", WiFi.softAPIP());

    server.on("/", sendLiveHTML);
    server.on("/log", sendLogFile);
    server.on("/files", sendFileList);
    server.on("/api/data", sendChartJSON);
    server.on("/api/chart", sendChartJSON);
    // 路由: /log_xxx.csv 或 /log/log_xxx.csv
    server.on("/log.txt", sendLogFile);
    // 给 archive 文件用的通配路由
    server.onNotFound([]() {
        String uri = server.uri();
        if (uri.startsWith("/log_") || uri.startsWith("/log/log_")) {
            sendLogFile();
        } else {
            server.send(302, "", "<!DOCTYPE html><html><head>"
                "<meta http-equiv='refresh' content='0;url=/'>"
                "</head></html>");
        }
    });
    server.begin();

    // ---- BLE 蓝牙 ----
    initBLE();

    // ---- WiFi STA (校园网 + HTTP 推送) ----
    if (strlen(STA_SSID) > 0) {
        showDiag("Connecting STA...", 4);
        sta_ok = staConnect();
        showDiag(sta_ok ? "STA connected" : "STA failed", 4);
    }
    showDiag("BLE ready", 3);

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
    if (wifi_ok) { dnsServer.processNextRequest(); server.handleClient(); }

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

    // 日志 + BLE 推送 (每 30s)
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
        lastLogTime = now;
        if (!isnan(temp) && !isnan(humid)) {
            writeLogLine(temp, humid);
            logCount++;

            // BLE 发送 JSON 数据
            char bleBuf[256];
            char ts[24]; getTimeStr(ts, sizeof(ts));
            snprintf(bleBuf, sizeof(bleBuf),
                "{\"temp\":%.1f,\"humid\":%.1f,\"gps\":\"%.6fN %.6fE\","
                "\"bat\":%.2f,\"time\":\"%s\"}",
                temp, humid, FIXED_GPS_LAT, FIXED_GPS_LON, batVol, ts);
            bleSend(bleBuf);
            httpSend(temp, humid, batVol);
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





