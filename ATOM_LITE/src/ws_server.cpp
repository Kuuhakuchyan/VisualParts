#include "ws_server.h"
#include "config.h"
#include "logger.h"
#include "chart.h"
#include "rtc.h"
#include "position.h"
#include <esp_netif.h>
#include <ESPmDNS.h>
#include <Arduino.h>
#include <M5Unified.h>
#include <LittleFS.h>

static WebServer  server(80);
static DNSServer  dns;
static bool       _active = false;
static char       _ip[16] = "0.0.0.0";

// 引用 main.cpp 中的全局缓存
extern float ws_ws_lastTemp, ws_ws_lastHumid;

// ---------- 网页首页 ----------
static void handle_root() {
    char t[8], h[8];
    snprintf(t, sizeof(t), "%.1f", isnan(ws_lastTemp) ? 0.0 : ws_lastTemp);
    snprintf(h, sizeof(h), "%.1f", isnan(ws_lastHumid) ? 0.0 : ws_lastHumid);
    char timeStr[24]; rtc_get_time_str(timeStr, sizeof(timeStr));
    double lat = pos_get_lat(), lon = pos_get_lon();

    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>ATOM Weather</title>"
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
        "<h2>ATOM Weather</h2>"
        "<div class='ts'>" + String(timeStr) + "</div>"
        "<div class='g'>"
        "<div class='b'><div class='l'>Temp</div><div class='v' style='color:#00e5ff'>" + String(t) + "C</div></div>"
        "<div class='b'><div class='l'>Humi</div><div class='v' style='color:#ffea00'>" + String(h) + "%</div></div>"
        "<div class='b'><div class='l'>Power</div><div class='v' style='color:#76ff03'>USB</div></div>"
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
        // 实时位置: 优先 Leaflet 卫星图 (需要外网), 失败降级 Canvas
        "var _lat=" + String(lat, 5) + ",_lon=" + String(lon, 5) + ";"
        "var _m=document.getElementById('map');"
        "function initMap(){try{"
        "var m=L.map('map',{zoomControl:false}).setView([_lat,_lon],16);"
        // 天地图 DataServer (云平台新版接口)
        "var tk='" AMAP_TK "';"
        "var td='https://t{s}.tianditu.gov.cn/DataServer?T=';"
        "L.tileLayer(td+'vec_w&x={x}&y={y}&l={z}&tk='+tk,"
        "{maxZoom:18,subdomains:['0','1','2','3','4','5','6','7']}).addTo(m);"
        "L.tileLayer(td+'cva_w&x={x}&y={y}&l={z}&tk='+tk,"
        "{maxZoom:18,subdomains:['0','1','2','3','4','5','6','7'],opacity:.7}).addTo(m);"
        "var dot=L.circleMarker([_lat,_lon],{radius:9,color:'#2196F3',"
        "fillColor:'#2196F3',fillOpacity:.8,weight:3}).addTo(m);"
        "setInterval(function(){fetch('/api/position').then(r=>r.json()).then(d=>{"
        "if(!d.lat)return;_lat=d.lat;_lon=d.lon;dot.setLatLng([d.lat,d.lon]);"
        "document.getElementById('posInfo').textContent="
        "d.lat.toFixed(5)+'N '+d.lon.toFixed(5)+'E '+d.src+' ±'+d.acc+'m';"
        "})},5000);"
        "}catch(e){drawCanvas()}}"
        // Canvas 降级
        "function drawCanvas(){"
        "_m.innerHTML='<canvas id=\"cPos\" width=\"440\" height=\"240\""
        " style=\"width:100%;height:240px;border-radius:10px\"></canvas>';"
        "var cx=document.getElementById('cPos').getContext('2d');"
        "function d(lat,lon,src,acc){"
        "var w=440,h=240;cx.fillStyle='#1a1a2e';cx.fillRect(0,0,w,h);"
        "cx.strokeStyle='#2a2a4e';cx.lineWidth=1;"
        "cx.beginPath();cx.moveTo(w/2,0);cx.lineTo(w/2,h);"
        "cx.moveTo(0,h/2);cx.lineTo(w,h/2);cx.stroke();"
        "cx.fillStyle='#888';cx.font='11px sans-serif';cx.textAlign='center';"
        "cx.fillText(lat.toFixed(5)+'N',w/2,18);"
        "cx.fillText(lon.toFixed(5)+'E',w/2,34);"
        "cx.fillText(src+' ±'+acc+'m',w/2,50);"
        "var g=cx.createRadialGradient(w/2,h/2,2,w/2,h/2,12);"
        "g.addColorStop(0,'#64B5F6');g.addColorStop(1,'#1565C0');"
        "cx.fillStyle=g;cx.beginPath();cx.arc(w/2,h/2,10,0,Math.PI*2);cx.fill();"
        "cx.strokeStyle='#2196F380';cx.lineWidth=3;"
        "cx.beginPath();cx.arc(w/2,h/2,14,0,Math.PI*2);cx.stroke();"
        "}d(_lat,_lon,'"+ String(pos_get_source()) + "'," + String(pos_get_accuracy()) + ");"
        "setInterval(function(){fetch('/api/position').then(r=>r.json()).then(dd=>{"
        "if(!dd.lat)return;_lat=dd.lat;_lon=dd.lon;"
        "d(dd.lat,dd.lon,dd.src,dd.acc);"
        "document.getElementById('posInfo').textContent="
        "dd.lat.toFixed(5)+'N '+dd.lon.toFixed(5)+'E '+dd.src+' ±'+dd.acc+'m';"
        "})},5000);}"
        // 动态加载 Leaflet
        "var ls=document.createElement('link');ls.rel='stylesheet';"
        "ls.href='https://cdn.bootcdn.net/ajax/libs/leaflet/1.9.4/leaflet.css';"
        "document.head.appendChild(ls);"
        "var lj=document.createElement('script');"
        "lj.src='https://cdn.bootcdn.net/ajax/libs/leaflet/1.9.4/leaflet.js';"
        "lj.onload=initMap;lj.onerror=drawCanvas;"
        "document.body.appendChild(lj);"
        // 5s CDN 超时降级 Canvas
        "setTimeout(function(){if(typeof L==='undefined')drawCanvas();},5000);"
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
    int cnt = n > mx ? mx : n;

    String json = "{\"count\":" + String(cnt) + ",\"temp\":[";
    for (int i = 0; i < cnt; i++) {
        if (i > 0) json += ",";
        json += String(isnan(chart_get_temp(i)) ? 0 : chart_get_temp(i), 1);
    }
    json += "],\"humid\":[";
    for (int i = 0; i < cnt; i++) {
        if (i > 0) json += ",";
        json += String(isnan(chart_get_humid(i)) ? 0 : chart_get_humid(i), 1);
    }
    json += "]}";
    server.send(200, "application/json", json);
}

// ---------- 初始化 ----------
bool webserver_init() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(500);
    _active = true;
    strncpy(_ip, WiFi.softAPIP().toString().c_str(), sizeof(_ip) - 1);
    Serial.printf("AP: %s | IP: %s\n", AP_SSID, _ip);

    // mDNS: 连接 AP 后打开 http://atomweather.local 即可访问
    if (MDNS.begin("atomweather")) {
        MDNS.addService("http", "tcp", 80);
        Serial.println("mDNS: http://atomweather.local");
    }

    // 不启用 DNS 劫持, 手机连接 AP 后手动打开

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

void webserver_handle() { if (_active) server.handleClient(); }
bool webserver_is_active() { return _active; }
const char* webserver_get_ip() { return _ip; }
