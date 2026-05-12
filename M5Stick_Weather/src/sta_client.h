#pragma once

bool sta_init();
void sta_tick();
bool sta_send(float temp, float humid, float bat_v);
bool sta_is_connected();
