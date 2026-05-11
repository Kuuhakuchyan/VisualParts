#include "ble.h"
#include "config.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

static BLEServer*         _server   = nullptr;
static BLECharacteristic* _txChar   = nullptr;
static bool               _connected = false;

class MyCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* s)    { _connected = true;  Serial.println("BLE: connected"); }
    void onDisconnect(BLEServer* s) { _connected = false; Serial.println("BLE: disconnected");
        _server->startAdvertising(); }
};

bool ble_init() {
    BLEDevice::init(BLE_DEVICE_NAME);
    BLEDevice::setPower(ESP_PWR_LVL_P9);
    _server = BLEDevice::createServer();
    _server->setCallbacks(new MyCallbacks());

    BLEService* svc = _server->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    _txChar = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_NOTIFY);
    _txChar->addDescriptor(new BLE2902());
    svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
        BLECharacteristic::PROPERTY_WRITE);
    svc->start();

    BLEAdvertising* adv = BLEDevice::getAdvertising();
    adv->addServiceUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    adv->setScanResponse(true);
    adv->setMinPreferred(0x06);
    adv->setMaxPreferred(0x0C);
    adv->start();
    Serial.println("BLE: " BLE_DEVICE_NAME);
    return true;
}

void ble_send(const char* data) {
    if (!_connected || !_txChar) return;
    _txChar->setValue((uint8_t*)data, strlen(data));
    _txChar->notify();
}

bool ble_is_connected() { return _connected; }
