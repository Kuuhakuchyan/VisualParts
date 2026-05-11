#pragma once
#include <cstdint>

bool sht30_init(int sda, int scl);
bool sht30_read(float &temp, float &humid);
void sht30_reset();
bool sht30_is_found();
int  sht30_used_sda();
int  sht30_used_scl();
