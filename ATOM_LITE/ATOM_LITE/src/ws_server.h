#pragma once
#include <WebServer.h>
#include <DNSServer.h>

bool ws_init();
void ws_handle();
const char* ws_get_ip();
extern float ws_lastTemp;
extern float ws_lastHumid;
