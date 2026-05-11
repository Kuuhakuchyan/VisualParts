#include "ws_server.h"
#include "config.h"
#include "logger.h"
#include "chart.h"
#include "rtc.h"
#include "position.h"
#include <Arduino.h>
#include <M5Unified.h>
#include <LittleFS.h>

static WebServer  server(80);
static DNSServer  dns;
static bool       _active = false;
static char       _ip[16] = "0.0.0.0";

// 引用 main.cpp 中的全局缓存
extern float lastTemp;
extern float lastHumid;

// ---------- 网页首页 ----------
static void handle_root() {
    char t[8], h[8];
    snprintf(t, sizeof(t), "%.1f", isnan(lastTemp) ? 0.0 : lastTemp);
    snprintf(h, sizeof(h), "%.1f", isnan(lastHumid) ? 0.0 : lastHumid);
    char timeStr[24]; rtc_get_time_str(timeStr, sizeof(timeStr));
    double lat = pos_get_lat(), lon = pos_get_lon();

    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>M5StickC Plus2</title>"
        "<style>*{margin:0;padding:0;box-sizing:border-box}"
        "body{font-family:sans-serif;text-align:center;padding:12px;background:#111;color:#fff}"
        "h2{color:orange;font-size:20px}"
        ".ts{color:#888;font-size:12px;margin:4px 0 12px}"
        ".g{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}"
        ".b{background:#1a1a2e;border-radius:10px;padding:10px 16px;min-width:100px}"
        ".l{color:#888;font-size:12px}.v{font-size:28px;font-weight:bold}"
        "canvas{width:100%;max-width:440px;height:130px;background:#1a1a2e;border-radius:10px;margin:4px 0}"
        "#map{width:100%;height:240px;border-radius:10px;margin:6px 0;background:#1a1a2e}"
        "a{color:#4fc3f7;font-size:13px}.pos{color:#888;font-size:12px;margin:4px}"
        "</style></head><body>"
        "<h2>M5StickC Plus2</h2>"
        "<div class='ts'>" + String(timeStr) + "</div>"
        "<div class='g'>"
        "<div class='b'><div class='l'>Temp</div><div class='v' style='color:#00e5ff'>" + String(t) + "C</div></div>"
        "<div class='b'><div class='l'>Humi</div><div class='v' style='color:#ffea00'>" + String(h) + "%</div></div>"
        "<div class='b'><div class='l'>Battery</div><div class='v' style='color:#76ff03'>" + String(M5.Power.getBatteryVoltage()/1000.0f, 2) + "V</div></div>"
        "</div>"
        "<div class='pos' id='posInfo'>"
        + String(lat, 5) + "N " + String(lon, 5) + "E " + String(pos_get_source()) + " ±" + String(pos_get_accuracy()) + "m</div>"
        "<div id='map'><p style='padding:100px 0;color:#555'>Loading map...</p></div>"
        "<canvas id='cTemp'></canvas><canvas id='cHumi'></canvas>"
        "<div style='margin:6px'><a href='/files'>[Log Files]</a> &nbsp; <a href='/log'>[Download CSV]</a></div>"
        "<script>"
        "function draw(id,data,clr,unit){"
        "var c=document.getElementById(id),ctx=c.getContext('2d'),w=c.width=440,h=c.height=130;"
        "var P={t:12,r:8,b:18,l:32},cw=w-P.l-P.r,ch=h-P.t-P.b;"
        "ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h);"
        "if(!data||data.length<2)return;"
        "var mn=Math.min.apply(null,data),mx=Math.max.apply(null,data),rg=mx-mn||1;"
        "mn-=rg*0.1;mx+=rg*0.1;rg=mx-mn;"
        "ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.font='9px sans-serif';ctx.textAlign='right';"
        "for(var i=0;i<=4;i++){var yy=P.t+ch*i/4;"
        "ctx.beginPath();ctx.moveTo(P.l,yy);ctx.lineTo(w-P.r,yy);ctx.stroke();"
        "ctx.fillStyle='#888';ctx.fillText((mx-rg*i/4).toFixed(1),P.l-3,yy+3)}"
        "ctx.strokeStyle=clr;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();"
        "for(var i=0;i<data.length;i++){var x=P.l+i*cw/(data.length-1),y=P.t+ch-(data[i]-mn)*ch/rg;"
        "i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();"
        "ctx.fillStyle='#888';ctx.textAlign='center';ctx.font='10px sans-serif';"
        "ctx.fillText(unit,w/2,h-4)}"
        "fetch('/api/chart').then(r=>r.json()).then(d=>{"
        "draw('cTemp',d.temp,'#00e5ff','Temperature (C)');"
        "draw('cHumi',d.humid,'#ffea00','Humidity (%)')});"
        "setInterval(function(){fetch('/api/chart').then(r=>r.json()).then(d=>{"
        "draw('cTemp',d.temp,'#00e5ff','Temperature (C)');"
        "draw('cHumi',d.humid,'#ffea00','Humidity (%)')})},8000);"
        // 地图 (Leaflet, CDN 加载失败则保留位置文本)
        "var s=document.createElement('link');s.rel='stylesheet';"
        "s.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';"
        "document.head.appendChild(s);"
        "var j=document.createElement('script');j.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';"
        "j.onload=function(){"
        "var ll=[" + String(lat, 5) + "," + String(lon, 5) + "];"
        "var map=L.map('map',{zoomControl:false}).setView(ll,16);"
        "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);"
        "var m=L.circleMarker(ll,{radius:8,color:'#2196F3',fillColor:'#2196F3',fillOpacity:.8,weight:2}).addTo(map);"
        "setInterval(function(){fetch('/api/position').then(r=>r.json()).then(d=>{"
        "if(!d.lat)return;var l=[d.lat,d.lon];m.setLatLng(l);"
        "document.getElementById('posInfo').textContent="
        "d.lat.toFixed(5)+'N '+d.lon.toFixed(5)+'E '+d.src+' ±'+d.acc+'m';"
        "})},5000);"
        "};j.onerror=function(){document.getElementById('map').innerHTML='';};"
        "document.body.appendChild(j);"
        "</script></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}

// ---------- 日志文件 ----------
static void handle_log() {
    if (!logger_get_count()) { server.send(404, "text/plain", "No log"); return; }
    String path = server.uri();
    if (path == "/log" || path == "/log.txt") path = String(logger_get_filename());
    else if (path.startsWith("/log/")) path = "/" + path.substring(5);
    File f = LittleFS.open(path.c_str(), FILE_READ);
    if (!f) { server.send(404, "text/plain", "File not found"); return; }
    server.streamFile(f, "text/csv");
    f.close();
}

// ---------- 文件列表 ----------
static void handle_files() {
    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Log Files</title>"
        "<style>body{font-family:sans-serif;background:#111;color:#fff;padding:16px}"
        "a{color:#4fc3f7;display:block;padding:6px 0}"
        ".h{color:orange;font-size:18px;margin-bottom:12px}.s{color:#888;font-size:12px}</style></head><body>"
        "<div class='h'>Log Files</div>";
    File root = LittleFS.open("/");
    if (root && root.isDirectory()) {
        File f = root.openNextFile();
        while (f) {
            String n = f.name();
            if (n.startsWith("log_")) html += "<a href='/log/" + n + "'>" + n + " (" + String(f.size()) + "B)</a>";
            f.close(); f = root.openNextFile();
        }
        root.close();
    }
    html += "<div class='s'>Current: " + String(logger_get_filename()) + "</div>"
        "<p><a href='/'>Back</a></p></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}

// ---------- JSON 图表数据 ----------
static void handle_chart_json() {
    int n = chart_get_count();
    int mx = chart_get_max();
    int start = n > mx ? n - mx : 0;
    int cnt = n > mx ? mx : n;

    String json = "{\"count\":" + String(cnt) + ",\"temp\":[";
    for (int i = start; i < start + cnt; i++) {
        if (i > start) json += ",";
        json += String(isnan(chart_get_temp(i)) ? 0 : chart_get_temp(i), 1);
    }
    json += "],\"humid\":[";
    for (int i = start; i < start + cnt; i++) {
        if (i > start) json += ",";
        json += String(isnan(chart_get_humid(i)) ? 0 : chart_get_humid(i), 1);
    }
    json += "]}";
    server.send(200, "application/json", json);
}

// ---------- 初始化 ----------
bool webserver_init() {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(500);
    _active = true;
    strncpy(_ip, WiFi.softAPIP().toString().c_str(), sizeof(_ip) - 1);
    Serial.printf("AP: %s | IP: %s\n", AP_SSID, _ip);

    dns.start(53, "*", WiFi.softAPIP());

    server.on("/", handle_root);
    server.on("/log", handle_log);
    server.on("/log.txt", handle_log);
    server.on("/files", handle_files);
    server.on("/api/chart", handle_chart_json);
    server.on("/api/data", handle_chart_json);
    server.on("/api/position", []() {
        char buf[160];
        snprintf(buf, sizeof(buf),
            "{\"lat\":%.5f,\"lon\":%.5f,\"src\":\"%s\",\"acc\":%d}",
            pos_get_lat(), pos_get_lon(), pos_get_source(), pos_get_accuracy());
        server.send(200, "application/json", buf);
    });
    server.onNotFound([]() {
        String uri = server.uri();
        if (uri.startsWith("/log_") || uri.startsWith("/log/log_")) handle_log();
        else server.send(302, "", "<!DOCTYPE html><html><head>"
            "<meta http-equiv='refresh' content='0;url=/'>"
            "</head></html>");
    });
    server.begin();
    return true;
}

void webserver_handle() { if (_active) { dns.processNextRequest(); server.handleClient(); } }
bool webserver_is_active() { return _active; }
const char* webserver_get_ip() { return _ip; }
