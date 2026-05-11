#pragma once

bool sta_init();
bool sta_send(float temp, float humid, float bat_v);
bool sta_is_connected();
