#pragma once
#include <cstdint>

void led_init();
void led_set(uint32_t color, uint16_t brightness = 50);
void led_breath(uint32_t color, uint16_t brightness = 50);
void led_off();
void led_loop();  // 在 loop 中调用, 实现呼吸效果
