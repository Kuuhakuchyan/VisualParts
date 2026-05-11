#pragma once
#include <cstddef>

void rtc_set_from_compile_time();
void rtc_get_time_str(char *buf, size_t len);
