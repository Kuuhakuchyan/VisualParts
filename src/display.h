#pragma once
#include <cstdint>

void display_init();
void draw_dashboard(float temp, float humid, float bat_v, bool full_init, const char *time_str);
void draw_line_chart(const char *title, uint16_t color, float *data, int count, const char *unit, const char *time_str);
void draw_log_line(unsigned long count, unsigned long size);
void draw_diag(const char *msg, int row);
void draw_title();
