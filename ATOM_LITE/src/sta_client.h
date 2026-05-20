#pragma once

bool sta_init();
void sta_tick();
bool sta_publish_telemetry(float temp, float humid, float bat_v);
bool sta_publish_gps();
bool sta_is_connected();

// 断网补传缓冲区
void backfill_push(unsigned long epoch, float temp, float humid);
bool backfill_needed();
