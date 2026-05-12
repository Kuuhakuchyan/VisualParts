#include "gps.h"
#include "config.h"
#include <Arduino.h>
#include <HardwareSerial.h>

static HardwareSerial _gpsPort(2);           // UART2 remap to GPS_RX_PIN
static double   _lat       = FIXED_GPS_LAT;
static double   _lon       = FIXED_GPS_LON;
static float    _alt       = 0;
static int      _sats      = 0;
static bool     _fix       = false;
static unsigned long _lastFixMs = 0;

static char     _buf[96];
static int      _pos       = 0;

// ---------- NMEA $GPGGA 解析 ----------
// 格式: $GPGGA,time,lat,NS,lon,EW,quality,sats,HDOP,alt,M,...
static void parseGPGGA(char* buf) {
    char* f[15];
    int n = 0; f[n++] = buf;
    for (char* p = buf; *p && n < 15; p++)
        if (*p == ',') { *p = '\0'; f[n++] = p + 1; }
    if (n < 10) return;

    int quality = atoi(f[6]);
    _fix = (quality > 0);
    _sats = atoi(f[7]);
    if (!_fix) return;

    // 纬度 DDMM.MMMM → 十进制度
    double raw = atof(f[2]);
    int deg = (int)(raw / 100);
    _lat = deg + (raw - deg * 100) / 60.0;
    if (f[3][0] == 'S') _lat = -_lat;

    // 经度 DDDMM.MMMM → 十进制度
    raw = atof(f[4]);
    deg = (int)(raw / 100);
    _lon = deg + (raw - deg * 100) / 60.0;
    if (f[5][0] == 'W') _lon = -_lon;

    _alt = atof(f[9]);
    _lastFixMs = millis();
}

void gps_init() {
    _gpsPort.begin(9600, SERIAL_8N1, GPS_RX_PIN, -1);
    Serial.printf("GPS: UART2 RX=G%d\n", GPS_RX_PIN);
}

void gps_update() {
    while (_gpsPort.available() && _pos < (int)sizeof(_buf) - 1) {
        char c = _gpsPort.read();
        if (c == '\n') {
            _buf[_pos] = '\0';
            if (strncmp(_buf, "$GPGGA", 6) == 0) parseGPGGA(_buf);
            _pos = 0;
        } else if (c != '\r') {
            _buf[_pos++] = c;
        }
    }
    if (_pos >= (int)sizeof(_buf) - 1) _pos = 0;
}

double gps_get_lat()    { return _lat; }
double gps_get_lon()    { return _lon; }
float  gps_get_alt()    { return _alt; }
int    gps_get_sats()   { return _sats; }
bool   gps_has_fix()    { return _fix; }
bool   gps_get_fresh()  { return _fix && (millis() - _lastFixMs < 5000); }
