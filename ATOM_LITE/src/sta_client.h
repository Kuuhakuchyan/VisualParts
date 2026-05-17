#pragma once

bool sta_init();
void sta_tick();
bool sta_publish_telemetry(float temp, float humid, float bat_v);
bool sta_publish_gps();
bool sta_is_connected();
