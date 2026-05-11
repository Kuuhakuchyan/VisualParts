#pragma once
#include <WebServer.h>
#include <DNSServer.h>

bool webserver_init();
void webserver_handle();
bool webserver_is_active();
const char* webserver_get_ip();
