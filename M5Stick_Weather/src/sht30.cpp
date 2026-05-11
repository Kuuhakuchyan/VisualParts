#include "sht30.h"
#include "config.h"
#include <M5Unified.h>

static bool  _found = false;
static int   _sda = 32, _scl = 33;

// ---------- 原始 I2C 读取 ----------
static bool read_raw(float &temp, float &humid) {
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

// ---------- 扫描引脚组合并初始化 ----------
bool sht30_init(int sda, int scl) {
    static const int pinTrials[][2] = I2C_SCAN_PINS;
    _found = false;
    for (int t = 0; t < 3 && !_found; t++) {
        _sda = pinTrials[t][0]; _scl = pinTrials[t][1];
        Wire.begin(_sda, _scl, I2C_FREQ); delay(10);
        Wire.beginTransmission(SHT30_ADDR);
        if (Wire.endTransmission(true) == 0) {
            _found = true;
            sht30_reset();
            float dummy_t, dummy_h;
            for (int r = 0; r < 3; r++) { if (read_raw(dummy_t, dummy_h)) break; delay(50); }
        }
    }
    return _found;
}

// ---------- 带重试的读取 ----------
bool sht30_read(float &temp, float &humid) {
    if (!_found) return false;
    for (int i = 0; i < SHT30_RETRY; i++) { if (read_raw(temp, humid)) return true; delay(50); }
    return false;
}

void sht30_reset() {
    Wire.beginTransmission(SHT30_ADDR);
    Wire.write(0x30); Wire.write(0xA2);
    Wire.endTransmission(true); delay(50);
}

bool sht30_is_found() { return _found; }
int  sht30_used_sda() { return _sda; }
int  sht30_used_scl() { return _scl; }
