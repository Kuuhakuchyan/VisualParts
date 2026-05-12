#include "ws_server.h"
#include "config.h"
#include "logger.h"
#include "chart.h"
#include "rtc.h"
#include <Arduino.h>
#include <LittleFS.h>

static WebServer server(80);
static DNSServer dns;
static char _ip[16] = "0.0.0.0";
extern float ws_lastTemp, ws_lastHumid;

static void handle_root() {
    char t[8], h[8];
    snprintf(t, sizeof(t), "%.1f", isnan(ws_lastTemp) ? 0 : ws_lastTemp);
    snprintf(h, sizeof(h), "%.1f", isnan(ws_lastHumid) ? 0 : ws_lastHumid);
    char ts[24]; rtc_get_time_str(ts, sizeof(ts));

    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>ATOM Weather</title>"
        "<style>*{margin:0;padding:0;box-sizing:border-box}"
        "body{font-family:sans-serif;text-align:center;padding:12px;background:#111;color:#fff}"
        "h2{color:orange;font-size:20px}"
        ".ts{color:#888;font-size:12px;margin:8px}"
        ".g{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}"
        ".b{background:#1a1a2e;border-radius:10px;padding:10px 16px;min-width:100px}"
        ".l{color:#888;font-size:12px}.v{font-size:28px;font-weight:bold}"
        "canvas{width:100%;max-width:440px;height:150px;background:#1a1a2e;border-radius:10px;margin:4px 0}"
        "a{color:#4fc3f7;font-size:13px}</style></head><body>"
        "<h2>ATOM Weather</h2>"
        "<div class='ts'>" + String(ts) + "</div>"
        "<div class='g'>"
        "<div class='b'><div class='l'>Temp</div><div class='v' style='color:#00e5ff'>" + String(t) + "C</div></div>"
        "<div class='b'><div class='l'>Humi</div><div class='v' style='color:#ffea00'>" + String(h) + "%</div></div>"
        "</div>"
        "<div style='color:#888;font-size:12px;margin:8px'>"
        + String(FIXED_GPS_LAT,6) + "N / " + String(FIXED_GPS_LON,6)
        + "E &nbsp; Log: " + String(logger_get_count()) + " lines</div>"
        "<canvas id='cTemp'></canvas><canvas id='cHumi'></canvas>"
        "<div style='margin:8px'><a href='/files'>[Log Files]</a> &nbsp; <a href='/log'>[Download]</a></div>"
        "<script>"
        "function draw(id,d,c,u){var e=document.getElementById(id),x=e.getContext('2d'),w=e.width=440,h=e.height=150;"
        "var P={t:15,r:10,b:22,l:36},cw=w-P.l-P.r,ch=h-P.t-P.b;"
        "x.fillStyle='#1a1a2e';x.fillRect(0,0,w,h);if(!d||d.length<2)return;"
        "var mn=Math.min.apply(null,d),mx=Math.max.apply(null,d),rg=mx-mn||1;mn-=rg*0.1;mx+=rg*0.1;rg=mx-mn;"
        "x.strokeStyle='#333';x.lineWidth=1;x.font='10px sans-serif';x.textAlign='right';"
        "for(var i=0;i<=4;i++){var y=P.t+ch*i/4;x.beginPath();x.moveTo(P.l,y);x.lineTo(w-P.r,y);x.stroke();"
        "x.fillStyle='#888';x.fillText((mx-rg*i/4).toFixed(1),P.l-4,y+3)}"
        "x.strokeStyle=c;x.lineWidth=2;x.lineJoin='round';x.beginPath();"
        "for(var i=0;i<d.length;i++){var xv=P.l+i*cw/(d.length-1),yv=P.t+ch-(d[i]-mn)*ch/rg;"
        "i===0?x.moveTo(xv,yv):x.lineTo(xv,yv)}x.stroke();"
        "x.fillStyle='#888';x.textAlign='center';x.font='11px sans-serif';x.fillText(u,w/2,h-4)}"
        "fetch('/api/chart').then(r=>r.json()).then(d=>{"
        "draw('cTemp',d.temp,'#00e5ff','Temp(C)');draw('cHumi',d.humid,'#ffea00','Humi(%)')});"
        "setInterval(function(){fetch('/api/chart').then(r=>r.json()).then(d=>{"
        "draw('cTemp',d.temp,'#00e5ff','Temp(C)');draw('cHumi',d.humid,'#ffea00','Humi(%)')})},8000);"
        "</script></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}

static void handle_log() {
    String path = server.uri();
    if (path == "/log" || path == "/log.txt") path = String(logger_get_filename());
    else if (path.startsWith("/log/")) path = "/" + path.substring(5);
    File f = LittleFS.open(path.c_str(), FILE_READ);
    if (!f) { server.send(404, "text/plain", "Not found"); return; }
    server.streamFile(f, "text/csv"); f.close();
}

static void handle_files() {
    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Log Files</title><style>body{font-family:sans-serif;background:#111;color:#fff;padding:16px}"
        "a{color:#4fc3f7;display:block;padding:6px 0}"
        ".h{color:orange;font-size:18px;margin-bottom:12px}</style></head><body>"
        "<div class='h'>Log Files</div>";
    File r = LittleFS.open("/"); if (r && r.isDirectory()) {
        File f = r.openNextFile(); while (f) {
            String n = f.name(); if (n.startsWith("log_"))
                html += "<a href='/log/"+n+"'>"+n+" ("+String(f.size())+"B)</a>";
            f.close(); f = r.openNextFile();
        } r.close();
    }
    html += "<p><a href='/'>Back</a></p></body></html>";
    server.send(200, "text/html; charset=UTF-8", html);
}

static void handle_chart() {
    int n = chart_get_count(), mx = MAX_CHART_POINTS;
    int start = n > mx ? n - mx : 0, cnt = n > mx ? mx : n;
    float *tp = chart_get_temp_ptr(), *hp = chart_get_humid_ptr();
    String j = "{\"count\":" + String(cnt) + ",\"temp\":[";
    for (int i = start; i < start+cnt; i++) { if (i > start) j += ","; j += String(isnan(tp[i])?0:tp[i],1); }
    j += "],\"humid\":[";
    for (int i = start; i < start+cnt; i++) { if (i > start) j += ","; j += String(isnan(hp[i])?0:hp[i],1); }
    j += "]}";
    server.send(200, "application/json", j);
}

bool ws_init() {
    WiFi.mode(WIFI_AP); WiFi.softAP(AP_SSID, AP_PASS); delay(500);
    strncpy(_ip, WiFi.softAPIP().toString().c_str(), sizeof(_ip)-1);
    Serial.printf("AP: %s | IP: %s\n", AP_SSID, _ip);
    dns.start(53, "*", WiFi.softAPIP());
    server.on("/", handle_root); server.on("/log", handle_log);
    server.on("/log.txt", handle_log); server.on("/files", handle_files);
    server.on("/api/chart", handle_chart); server.on("/api/data", handle_chart);
    server.onNotFound([]() {
        String u = server.uri();
        if (u.startsWith("/log_") || u.startsWith("/log/log_")) handle_log();
        else server.send(302, "", "<!DOCTYPE html><html><head><meta http-equiv='refresh' content='0;url=/'></head></html>");
    });
    server.begin();
    return true;
}

void ws_handle() { dns.processNextRequest(); server.handleClient(); }
const char* ws_get_ip() { return _ip; }
