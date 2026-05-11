#include "display.h"
#include "config.h"
#include "position.h"
#include <M5Unified.h>

void display_init() {
    M5.Display.setRotation(1);
    M5.Display.setBrightness(255);
    M5.Display.setTextSize(2);
}

void draw_title() {
    M5.Display.setTextColor(ORANGE);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print("M5StickC Plus2");
}

void draw_dashboard(float temp, float humid, float bat_v, bool full_init, const char *time_str) {
    char buf[32];

    if (full_init) {
        M5.Display.fillScreen(BLACK);
        draw_title();
    }

    // 日期时间
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", time_str);

    // 温度
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.fillRect(10, TEMP_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, TEMP_Y);
    snprintf(buf, sizeof(buf), !isnan(temp) ? "Temp: %.1f C  " : "Temp: --.- C  ", temp);
    M5.Display.print(buf);

    // 湿度
    M5.Display.fillRect(10, HUMI_Y, 220, 18, BLACK);
    M5.Display.setCursor(10, HUMI_Y);
    snprintf(buf, sizeof(buf), !isnan(humid) ? "Humi: %.1f %%  " : "Humi: --.- %%  ", humid);
    M5.Display.print(buf);

    // 位置 (GPS/WiFi/Fixed)
    M5.Display.fillRect(10, GPS_Y, 220, 16, BLACK);
    M5.Display.setTextSize(1.8);
    M5.Display.setTextColor(YELLOW, BLACK);
    M5.Display.setCursor(10, GPS_Y);
    const char* src = pos_get_source();
    if (pos_has_fix()) {
        snprintf(buf, sizeof(buf), "%s: %.5fN %.5fE  ",
                 src, pos_get_lat(), pos_get_lon());
    } else {
        snprintf(buf, sizeof(buf), "Pos: searching...  ");
    }
    M5.Display.print(buf);

    // 电池
    M5.Display.fillRect(10, BAT_Y, 220, 18, BLACK);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(GREEN, BLACK);
    M5.Display.setCursor(10, BAT_Y);
    M5.Display.printf("BAT: %.2fV  ", bat_v);
}

void draw_line_chart(const char *title, uint16_t color, float *data, int count, const char *unit, const char *time_str) {
    char buf[32];
    M5.Display.fillScreen(BLACK);

    M5.Display.setTextColor(color);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(10, TITLE_Y);
    M5.Display.print(title);

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TIME_Y);
    M5.Display.printf("%-22s", time_str);
    M5.Display.setTextSize(2);

    if (count < 2) {
        M5.Display.setTextColor(DARKGREY);
        M5.Display.setCursor(50, 65);
        M5.Display.print("Collecting...");
        M5.Display.setTextSize(1);
        M5.Display.setCursor(65, 90);
        M5.Display.print("(need 2+ points)");
        return;
    }

    const int CX = 10, CY = 34, CW = 220, CH = 76;
    int start = count > MAX_CHART_POINTS ? count - MAX_CHART_POINTS : 0;
    int cnt   = count > MAX_CHART_POINTS ? MAX_CHART_POINTS : count;

    float dMin = 999, dMax = -999;
    for (int i = start; i < start + cnt; i++) {
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

    for (int i = start + 1; i < start + cnt; i++) {
        if (isnan(data[i]) || isnan(data[i-1])) continue;
        int x1 = CX + (i-1-start) * CW / (cnt-1);
        int y1 = CY + CH - (int)((data[i-1] - dMin) * CH / range);
        int x2 = CX + (i-start) * CW / (cnt-1);
        int y2 = CY + CH - (int)((data[i] - dMin) * CH / range);
        M5.Display.drawLine(x1, y1, x2, y2, color);
    }

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(GREEN);
    snprintf(buf, sizeof(buf), "Min:%.1f%s", dMin + range*0.1f, unit);
    M5.Display.setCursor(CX, CY + CH + 4); M5.Display.print(buf);
    M5.Display.setTextColor(YELLOW);
    snprintf(buf, sizeof(buf), "Max:%.1f%s", dMax - range*0.1f, unit);
    M5.Display.setCursor(CX + 100, CY + CH + 4); M5.Display.print(buf);
    M5.Display.setTextColor(DARKGREY);
    snprintf(buf, sizeof(buf), "%dpts", cnt);
    M5.Display.setCursor(CX + 180, CY + CH + 4); M5.Display.print(buf);
}

void draw_log_line(unsigned long count, unsigned long size) {
    M5.Display.fillRect(10, LOG_Y, 220, 18, BLACK);
    M5.Display.setTextColor(CYAN, BLACK);
    M5.Display.setCursor(10, LOG_Y);
    M5.Display.printf("Log: %lu (%luB)", count, size);
}

void draw_diag(const char* msg, int row) {
    M5.Display.setTextColor(WHITE, BLACK);
    M5.Display.setCursor(10, TEMP_Y + row * 18);
    M5.Display.setTextSize(1);
    M5.Display.print("                   ");
    M5.Display.setCursor(10, TEMP_Y + row * 18);
    M5.Display.print(msg);
    M5.Display.setTextSize(2);
}
