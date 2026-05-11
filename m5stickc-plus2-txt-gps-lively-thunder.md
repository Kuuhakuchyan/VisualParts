# M5StickC Plus2 温湿度显示 + TXT 记录 + GPS预留

## Context

M5StickC Plus2 已连接官方 ENV III 温湿度传感器模块（SHT30，I2C接口），目前仅有基本显示（标题、状态、电池电压）。需要实现：
1. 读取 SHT30 的温度和湿度并显示在屏幕上
2. 将温湿度数据（带时间戳）写入 TXT 文件存于设备内部 flash（LittleFS）
3. 预留 GPS 定位接口，方便以后接入 UART GPS 模块
4. 后续可扩展为通过 Wi-Fi 回传数据库

用户暂无 GPS 模块，先做温湿度 + 本地记录。

## 关键硬件信息

| 组件 | 接口 | 地址/引脚 |
|------|------|-----------|
| M5StickC Plus2 | — | ESP32-PICO-V3-02, 8MB Flash |
| SHT30 (ENV III) | I2C (Grove Port A) | 0x44 (默认) |
| RTC BM8563 | 内部 I2C | 内置 |
| 屏幕 ST7789 | SPI | 240×135, 旋转模式1 |
| GPS (预留) | UART | TBD |

## 实施步骤

### Step 1: 更新 platformio.ini — 添加依赖库

在 `lib_deps` 中添加：
- `adafruit/Adafruit SHT31@^2.2.0` — 用于读取 SHT30 温湿度传感器

### Step 2: 重写 main.cpp

#### 2.1 头文件与全局变量

```cpp
#include <M5Unified.h>
#include <Adafruit_SHT31.h>
#include <LittleFS.h>
#include <time.h>
```

全局变量：
- `Adafruit_SHT31 sht31;` — 温湿度传感器对象
- `unsigned long lastLogTime = 0;` — 控制记录间隔
- `const unsigned long LOG_INTERVAL = 30000;` — 每30秒记录一次

#### 2.2 setup() 逻辑

1. **M5.begin(cfg)** — 初始化硬件
2. **I2C 初始化** — Wire.begin() + sht31.begin(0x44)
3. **RTC 初始化** — 利用 M5Unified 内置 RTC（BM8563），首次运行时用编译时间设置初始时间
4. **LittleFS 初始化** — LittleFS.begin()，挂载内部 flash
5. **显示布局** — 清屏，显示静态标签

显示布局（旋转模式1，240×135）：
```
┌──────────────────────────────┐
│  M5StickC Plus2    ⚡4.12V   │  Y=5
│  Temp: 25.5°C                │  Y=30
│  Humi: 60.2%                 │  Y=55
│  GPS: --- (未连接)            │  Y=80
│  Log: OK  #42                │  Y=110
└──────────────────────────────┘
```

#### 2.3 loop() 逻辑

每次循环：
1. `M5.update()` — 刷新按键/IMU
2. **读取 SHT30** — `sht31.readTemperature()` 和 `sht31.readHumidity()`
3. **读取 RTC** — `M5.Rtc` 获取当前时间
4. **更新显示** — 局部刷新温湿度值，GPS 状态显示"未连接"
5. **周期性写入 TXT** — 每 LOG_INTERVAL 毫秒追加一条记录到文件 `log.txt`
6. **电池电压** — 保留原有的 BAT 显示

#### 2.4 TXT 记录格式

使用 CSV 格式，每行一条记录：
```
2026-05-11 14:30:00, 25.5, 60.2, 0.000000, 0.000000
```
字段：`datetime, temp_c, humidity_pct, gps_lat, gps_lon`
- GPS 字段留为 0，将来接入后填充真实值
- 标题行仅在文件不存在时写入一次

#### 2.5 文件管理

- 使用 LittleFS（比 SPIFFS 更可靠）
- 文件路径：`/log.txt`
- 每次追加，不覆盖
- 提供判断文件是否存在 → 决定是否写标题行
- 预留后续改为按日期分文件的功能

### Step 3: GPS 预留接口

目前 GPS 部分做空占位处理：
- 显示 "GPS: ---" 灰色文字
- log.txt 中的 GPS 字段写 0.000000
- 将来接入时只需：
  1. 在平台io.ini 添加 TinyGPSPlus 库
  2. 增加 UART2 初始化（Serial2）
  3. 创建 TinyGPSPlus 对象解析 NMEA
  4. 填充显示和日志中的 GPS 字段

推荐接法（M5StickC Plus2 底部引脚）：
| GPS 模块 | M5StickC Plus2 |
|----------|----------------|
| TX       | GPIO 34 (RX2)  |
| RX       | GPIO 0 (TX2)   |
| VCC      | 5V / 3.3V      |
| GND      | GND            |

### Step 4: 后续扩展路径

| 阶段 | 功能 | 备注 |
|------|------|------|
| 当前 | 温湿度显示 + TXT记录 | 本计划实现 |
| 扩展1 | 接入 UART GPS | 仅需添加库 + UART 初始化 |
| 扩展2 | Wi-Fi 回传数据库 | 添加 WiFi / HTTPClient |
| 扩展3 | 按键交互 / 页面切换 | 利用 M5.BtnA/BtnB |

## 需要修改的文件

| 文件 | 操作 |
|------|------|
| `platformio.ini` | 添加 Adafruit SHT31 到 lib_deps |
| `src/main.cpp` | 完整重写，集成温湿度读取+显示+日志 |

## 验证方式

1. **编译上传** — PlatformIO 编译无错误，成功上传到 COM11
2. **串口监视器** — 115200 baud，观察传感器读数和调试输出
3. **屏幕显示** — 温湿度实时更新，Log 状态显示写入成功/计数
4. **TXT 文件验证** — 通过 LittleFS 读取 `/log.txt` 内容（可在代码中添加 `_listDir()` 功能或通过 WebSerial 导出）
