#include "led.h"
#include "config.h"
#include <Adafruit_NeoPixel.h>

#define LED_PIN  27
#define LED_NUM  1

static Adafruit_NeoPixel pixels(LED_NUM, LED_PIN, NEO_GRB + NEO_KHZ800);
static uint32_t _color  = 0;
static uint8_t  _bright = 50;
static bool     _breath = false;
static unsigned long _tick = 0;
static int      _step  = 0;

static uint32_t scale(uint32_t c, uint8_t b) {
    uint8_t r = ((c>>16)&0xFF) * b / 255;
    uint8_t g = ((c>>8)&0xFF)  * b / 255;
    uint8_t bl = (c&0xFF)      * b / 255;
    return pixels.Color(r, g, bl);
}

void led_init() { pixels.begin(); pixels.clear(); pixels.show(); }
void led_set(uint32_t c, uint16_t b) { _color=c; _bright=b; _breath=false; pixels.setPixelColor(0, scale(c,b)); pixels.show(); }
void led_breath(uint32_t c, uint16_t b) { _color=c; _bright=b; _breath=true; _step=0; }
void led_off() { pixels.clear(); pixels.show(); }

void led_loop() {
    if (!_breath) return;
    unsigned long n = millis();
    if (n - _tick < 30) return;
    _tick = n;
    float ph = (float)(_step % 256) / 256.0f * 6.2832f;
    uint8_t v = (uint8_t)((sinf(ph) + 1.0f) * 127.5f);
    pixels.setPixelColor(0, scale(_color, (uint16_t)v * _bright / 255));
    pixels.show();
    _step++;
}
