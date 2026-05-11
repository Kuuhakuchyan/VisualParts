#pragma once

bool sht30_init(int sda = 26, int scl = 32);
bool sht30_read(float &temp, float &humid);
bool sht30_is_found();
