#pragma once

void chart_add_point(float temp, float humid);
int  chart_get_count();
int  chart_get_start();
int  chart_get_max();
float chart_get_temp(int index);
float chart_get_humid(int index);
float* chart_get_temp_ptr();
float* chart_get_humid_ptr();
