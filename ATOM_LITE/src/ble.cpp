#include "ble.h"
#include "config.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

static BLEServer* _srv = nullptr;
static BLECharacteristic* _tx = nullptr;
static bool _conn = false;

class Cb : public BLEServerCallbacks {
    void onConnect(BLEServer* s) { _conn = true; Serial.println("BLE: connected"); }
    void onDisconnect(BLEServer* s) { _conn = false; _srv->startAdvertising(); }
};

bool ble_init() {
    BLEDevice::init(BLE_DEVICE_NAME);
    BLEDevice::setPower(ESP_PWR_LVL_P9);
    _srv = BLEDevice::createServer(); _srv->setCallbacks(new Cb());
    auto* svc = _srv->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    _tx = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_NOTIFY);
    _tx->addDescriptor(new BLE2902());
    svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_WRITE);
    svc->start();
    auto* adv = BLEDevice::getAdvertising();
    adv->addServiceUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    adv->setScanResponse(true); adv->setMinPreferred(6); adv->setMaxPreferred(12);
    adv->start();
    Serial.println("BLE: " BLE_DEVICE_NAME);
    return true;
}

void ble_send(const char* d) { if (_conn && _tx) { _tx->setValue((uint8_t*)d, strlen(d)); _tx->notify(); } }
bool ble_is_connected() { return _conn; }
