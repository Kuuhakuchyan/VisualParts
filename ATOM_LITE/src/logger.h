#pragma once

bool logger_init();
void logger_write(float temp, float humid);
void logger_dump();
bool logger_clear();
unsigned long logger_get_count();
unsigned long logger_get_size();
const char*   logger_get_filename();
