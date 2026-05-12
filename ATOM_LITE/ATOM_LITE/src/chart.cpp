#include "chart.h"
#include "config.h"
#include <cstring>

static float temps[MAX_CHART_POINTS];
static float humids[MAX_CHART_POINTS];
static int   count = 0;

void chart_add_point(float temp, float humid) {
    if (count < MAX_CHART_POINTS) {
        temps[count] = temp; humids[count] = humid; count++;
    } else {
        memmove(temps, temps+1, (MAX_CHART_POINTS-1)*sizeof(float));
        memmove(humids, humids+1, (MAX_CHART_POINTS-1)*sizeof(float));
        temps[MAX_CHART_POINTS-1] = temp;
        humids[MAX_CHART_POINTS-1] = humid;
    }
}
int chart_get_count() { return count; }
float* chart_get_temp_ptr() { return temps; }
float* chart_get_humid_ptr() { return humids; }
