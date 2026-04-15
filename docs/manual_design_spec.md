# 郑州黄河湿地"空天地"一体化智能监测平台

## 软件设计说明书

---

**文档编号**：SZDH-2026-001

**版本号**：V1.0

**编制日期**：2026年1月

**密级**：内部

---

## 文档修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| V1.0 | 2026-01-23 | - | 初稿编制 |

---

## 目录

1. 引言
2. 系统总体设计
3. 详细功能模块设计
4. 系统数据结构设计
5. 关键算法设计
6. 接口设计
7. 出错处理设计

---

## 1. 引言

### 1.1 编写目的

本文档旨在全面阐述郑州黄河湿地"空天地"一体化智能监测平台的技术架构和设计细节。本说明书作为软件开发过程中的重要技术文档，为开发团队提供详细的设计指导，同时作为软件著作权登记的技术材料，证明软件的原创性和技术含量。

本文档的预期读者包括：
- 软件开发人员：了解系统架构和模块设计，进行后续开发维护
- 项目管理人员：掌握项目整体技术方案，进行进度管理
- 软件著作权审查人员：了解软件的技术特征和创新点

### 1.2 适用范围

本软件主要应用于以下场景：

1. **湿地保护领域**：实现对湿地生态系统的实时监测、动态管理和科学保护
2. **生态监测领域**：支持多源生态数据的采集、存储、分析和可视化展示
3. **环境数据分析领域**：提供专业的空间分析和统计报表功能
4. **野生动物保护领域**：支持野生动物识别、栖息地分析和种群监测
5. **应急响应领域**：提供快速的异常预警和应急决策支持

### 1.3 技术背景

#### 1.3.1 前端技术架构

本系统前端采用现代化的Web技术栈：

| 技术组件 | 版本 | 用途说明 |
|----------|------|----------|
| HTML5 | 5 | 页面的结构化标记和语义化标签 |
| Canvas | 2D/3D | 高性能图形渲染，支持WebGL加速 |
| Leaflet | 1.9.4 | 开源WebGIS地图库，支持矢量切片和交互 |
| ECharts | 5.4.3 | 数据可视化图表库，支持统计图表展示 |
| WebGL | - | 3D图形渲染，应用于DEM高程数据可视化 |
| jQuery | 3.6.0 | DOM操作和事件处理 |
| Axios | - | HTTP客户端，用于前后端数据交互 |
| Turf.js | 6.5.0 | 空间分析库，支持缓冲区、叠加等分析 |
| GeoTIFF.js | 2.0.7 | 栅格数据解析，处理高程和遥感数据 |
| shp.js | 4.0.4 | Shapefile格式解析，支持矢量数据加载 |
| proj4 | 2.9.0 | 坐标系转换，支持UTM、Web Mercator等 |
| Leaflet.markercluster | 1.5.3 | 海量点聚合，优化大数据渲染性能 |
| chroma.js | 2.4.2 | 颜色处理，支持分级着色和色彩插值 |
| simple-statistics | 7.8.2 | 统计分析，支持数据聚合和分布计算 |

#### 1.3.2 后端技术架构

后端系统采用Python技术栈：

| 技术组件 | 版本 | 用途说明 |
|----------|------|----------|
| Python | 3.x | 后端开发语言 |
| DETR-ResNet-101 | facebook/detr-resnet-101-dc5 | 目标检测深度学习模型 |
| NMS | - | 非极大值抑制，用于目标检测后处理 |
| Flask/FastAPI | - | Web框架，提供RESTful API接口 |

#### 1.3.3 数据库技术架构

| 数据库 | 类型 | 用途说明 |
|--------|------|----------|
| SQLite | 关系型 | 轻量级数据存储，用于本地数据管理 |
| PostgreSQL+PostGIS | 空间数据库 | 专业GIS数据存储，支持空间索引和查询 |

#### 1.3.4 第三方数据服务

- **阿里云DataV**：提供行政区划边界数据
- **天地图API**：提供底图服务（矢量底图、影像底图）

---

## 2. 系统总体设计

### 2.1 系统架构设计

本系统采用B/S（浏览器/服务器）架构，实现"空天地"一体化监测理念：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户访问层 (Client)                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    现代浏览器 (Chrome/Edge)                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │  │地图渲染  │ │交互逻辑  │ │数据分析  │ │可视化展示│        │    │
│  │  │Leaflet   │ │JavaScript│ │Turf.js   │ │ECharts   │        │    │
│  │  │WebGL     │ │Vue/HTML  │ │算法处理  │ │Canvas    │        │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         应用服务层 (Service)                         │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      Nginx/Node.js Server                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │  │静态资源  │ │API网关   │ │代理转发  │ │负载均衡  │        │    │
│  │  │服务      │ │路由分发  │ │跨域处理  │ │缓存      │        │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      Python Backend                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │  │目标识别  │ │业务逻辑  │ │数据处理  │ │REST API  │        │    │
│  │  │AI模型    │ │服务封装  │ │数据清洗  │ │接口      │        │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          数据存储层 (Data)                           │
│  ┌──────────────────────┐  ┌──────────────────────┐                │
│  │   关系型数据库       │  │   空间数据库         │                │
│  │   SQLite/PostgreSQL  │  │   PostGIS扩展        │                │
│  │  ┌────────────────┐ │  │  ┌────────────────┐ │                │
│  │  │监测数据表      │ │  │  │空间矢量数据    │ │                │
│  │  │用户信息表      │ │  │  │栅格高程数据    │ │                │
│  │  │配置参数表      │ │  │  │遥感影像数据    │ │                │
│  │  └────────────────┘ │  │  └────────────────┘ │                │
│  └──────────────────────┘  └──────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.1.1 前端层职责

前端层负责实现以下核心功能：

1. **地图可视化**：基于Leaflet实现矢量/栅格数据加载和渲染
2. **交互操作**：实现图层控制、属性查询、空间量测等交互功能
3. **数据处理**：前端解析Shapefile、GeoJSON、DEM等数据格式
4. **空间分析**：利用Turf.js实现缓冲区、叠加等前端空间分析
5. **UI展示**：响应式界面设计，支持深色主题和多面板布局

#### 2.1.2 服务层职责

服务层负责实现以下核心功能：

1. **API网关**：统一管理和分发前端请求
2. **目标识别**：调用深度学习模型进行图像目标检测
3. **业务逻辑**：处理用户认证、数据管理、权限控制等
4. **数据服务**：提供RESTful API，支持JSON数据交换

#### 2.1.3 数据层职责

数据层负责实现以下核心功能：

1. **结构化数据存储**：监测记录、用户信息、配置参数
2. **空间数据存储**：矢量边界、遥感影像、高程数据
3. **空间索引**：PostGIS空间索引，支持高效空间查询
4. **数据备份**：定期备份机制，保障数据安全

### 2.2 运行环境

#### 2.2.1 客户端环境要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 浏览器 | Chrome 80+/Edge 80+ | Chrome 100+ |
| WebGL | 支持WebGL 1.0 | 支持WebGL 2.0 |
| 内存 | 4GB | 8GB+ |
| 网络 | 10Mbps | 100Mbps |

#### 2.2.2 服务器环境要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 操作系统 | Windows Server 2019 / Ubuntu 20.04 | CentOS 7+ / Ubuntu 22.04 |
| CPU | 4核心 | 8核心+ |
| 内存 | 8GB | 16GB+ |
| 硬盘 | 100GB SSD | 500GB+ SSD |
| Python | 3.8+ | 3.10+ |
| 数据库 | SQLite / PostgreSQL 13+ | PostgreSQL 15+ |

---

## 3. 详细功能模块设计

### 3.1 多源地理数据解析与加载模块

#### 3.1.1 模块概述

本模块负责解析和加载多种格式的地理空间数据，支持矢量数据和栅格数据的统一处理。

#### 3.1.2 功能描述

**Shapefile解析功能**

- 支持上传.zip格式的Shapefile压缩包
- 自动解压并读取.shp（几何数据）、.dbf（属性数据）、.prj（投影信息）文件
- 利用shp.js库将二进制数据转换为GeoJSON格式
- 实现属性字段的自动识别和数据类型转换

**栅格数据解析功能**

- 支持GeoTIFF格式的高程数据（DEM）和遥感影像
- 利用GeoTIFF.js读取栅格数据及其元信息
- 自动解析GeoTIFF坐标系信息（EPSG编码）
- 计算高程统计信息（最大值、最小值、平均值）

**GeoJSON数据解析功能**

- 支持标准GeoJSON格式的导入
- 自动识别几何类型（Point、LineString、Polygon、MultiPolygon）
- 支持属性字段的动态解析和展示

#### 3.1.3 Shapefile数据加载流程图

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ 用户上传 │────▶│ 解压Zip  │────▶│ 读取SHP  │────▶│ 读取DBF  │
│ ZIP文件  │     │ 压缩包   │     │ 几何数据 │     │ 属性数据 │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                      │
                      ┌──────────┐     ┌──────────┐     │
                      │ 读取PRJ  │────▶│ 转换坐标 │────▶│
                      │ 投影信息 │     │ 系WGS84  │     │
                      └──────────┘     └──────────┘     │
                                                      ▼
                     ┌───────────┐    ┌───────────┐    ┌───────────┐
                     │ 合并为    │───▶│ 样式渲染  │───▶│ 添加到    │
                     │ GeoJSON   │    │ QGIS解析  │    │ 地图显示  │
                     └───────────┘    └───────────┘    └───────────┘
```

#### 3.1.4 核心类设计

```javascript
class ShapefileLoader {
    // 解析Shapefile压缩包
    async parseZipFile(file) { }
    
    // 读取SHP文件
    async readShpFile(arrayBuffer) { }
    
    // 读取DBF文件
    async readDbfFile(arrayBuffer) { }
    
    // 读取PRJ文件
    async readPrjFile(arrayBuffer) { }
    
    // 转换为GeoJSON
    convertToGeoJSON(shpData, dbfData, prjData) { }
}
```

### 3.2 GIS可视化渲染模块

#### 3.2.1 模块概述

本模块负责将地理空间数据以可视化方式展示在地图上，提供丰富的渲染样式和交互效果。

#### 3.2.2 功能描述

**地图底图服务**

- 集成天地图矢量底图和影像底图
- 支持底图切换和透明度调节
- 实现多底图叠加显示

**矢量图层渲染**

- 支持点、线、面等多种几何类型
- 根据属性值进行分级着色渲染
- 实现热力图和聚合点两种渲染模式自动切换

**栅格数据渲染**

- DEM高程数据伪彩色渲染
- 根据高程范围自动生成色带
- 支持透明度调节和等高线叠加

**样式管理**

- 支持QML/SLD样式文件解析
- 实现QGIS分级样式和分类样式的自动转换
- 提供手动样式配置界面

#### 3.2.3 分级渲染引擎

QGISStyleProcessor类实现了专业的样式解析引擎：

```javascript
class QGISStyleProcessor {
    // 解析QML样式文件
    parseQML(qmlContent) { }
    
    // 解析分级样式（graduatedSymbol）
    parseGraduatedStyle(qmlContent) { }
    
    // 解析分类样式（categorizedSymbol）
    parseCategorizedStyle(qmlContent) { }
    
    // 解析简单样式（singleSymbol）
    parseSimpleStyle(qmlContent) { }
    
    // 生成分级颜色（RdBu色带）
    generateGraduatedColors(numClasses) { }
    
    // 应用样式到Leaflet图层
    applyStyleToLayer(geoJson, styleInfo, attributes) { }
}
```

#### 3.2.4 海量点聚合策略

系统实现了基于MarkerCluster的智能聚合算法：

1. **聚合条件判断**：当数据点超过clusterThreshold（默认1000）时自动启用聚合
2. **动态缩放切换**：根据缩放级别自动调整聚合半径
3. **蜘蛛网效果**：点击聚合点时展开显示所有子节点
4. **性能优化**：使用chunkedLoading分批加载，避免阻塞UI

### 3.3 空间分析与计算模块

#### 3.3.1 模块概述

本模块提供丰富的空间分析功能，支持前端实时计算和后端批量处理两种模式。

#### 3.3.2 功能描述

**几何简化算法**

- 基于Douglas-Peucker算法实现几何简化
- 支持可调节的容差参数（tolerance）
- 批量处理模式，避免大数据集处理阻塞UI

**缓冲区分析**

- 基于Turf.js实现点、线、面的缓冲区分析
- 支持自定义缓冲区半径
- 分析结果实时渲染到地图

**叠加分析**

- 支持多个图层之间的空间叠加运算
- 计算交集、差集、并集等结果
- 属性数据自动合并

**坐标转换**

- 自动识别UTM、Web Mercator等坐标系
- 利用proj4实现精确坐标转换
- 提供中国常用坐标系转换支持

#### 3.3.3 Douglas-Peucker算法实现

```javascript
class DataProcessor {
    // 几何简化（Douglas-Peucker算法）
    static simplifyGeometry(geometry, tolerance = 0.001) { }
    
    // 坐标序列简化
    static simplifyCoords(coords, tolerance) { }
    
    // 计算点到直线的垂直距离
    static distanceToLine(point, lineStart, lineEnd) { }
    
    // 批量处理要素
    static async processFeatures(features, options = {}) { }
    
    // 大数据集分批处理
    static async processLargeDataset(data, options = {}) { }
}
```

### 3.4 目标识别与智能监测模块

#### 3.4.1 模块概述

本模块集成深度学习技术，实现对无人机航拍图像和监控视频的智能目标识别。

#### 3.4.2 功能描述

**图像目标检测**

- 基于DETR-ResNet-101深度学习模型
- 支持鸟类、野生动物、违规行为等多类别识别
- 识别结果以JSON格式返回，包含边界框坐标和置信度

**实时监测**

- 支持对接实时视频流
- 目标轨迹追踪和计数统计
- 异常行为自动预警

**数据管理**

- 识别结果自动关联地理坐标
- 支持历史数据查询和统计分析
- 生成识别报告和统计报表

#### 3.4.3 目标识别流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ 图像采集 │────▶│ 图像预处理│────▶│ 模型推理 │────▶│ 结果解析 │
│ 无人机/  │     │ 尺寸调整  │     │ DETR     │     │ 边界框   │
│ 摄像头   │     │ 归一化    │     │ ResNet   │     │ 置信度   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                      │
                      ┌──────────┐     ┌──────────┐     │
                      │ 坐标关联 │────▶│ 地图标注 │────▶│
                      │ 经纬度   │     │ 可视化   │     │
                      └──────────┘     └──────────┘     │
                                                      ▼
                                             ┌──────────┐
                                             │ 数据存储 │
                                             │ 统计报表 │
                                             └──────────┘
```

### 3.5 数据库管理与API交互模块

#### 3.5.1 模块概述

本模块负责前后端数据交互和数据库管理，实现统一的数据访问接口。

#### 3.5.2 功能描述

**API接口设计**

- RESTful风格接口设计
- Token身份认证机制
- 支持跨域资源共享（CORS）

**数据库表结构**

- 监测数据表（observation_table）
- 固定监测点位表（zones）
- 监测样线表（transects）
- 用户信息表（profiles）
- 商品兑换表（products）

**前端数据请求**

- 基于Axios封装HTTP请求
- 统一处理请求/响应拦截
- 支持文件上传和数据查询

#### 3.5.3 API接口列表

| 接口路径 | 方法 | 功能说明 |
|----------|------|----------|
| /api/login/ | POST | 用户登录 |
| /api/profiles/me/ | GET | 获取用户信息 |
| /api/observations/ | GET/POST | 观测记录查询/上传 |
| /api/zones/ | GET | 获取监测点位 |
| /api/transects/ | GET | 获取监测样线 |
| /api/products/ | GET | 获取商品列表 |
| /api/products/{id}/redeem/ | POST | 商品兑换 |

---

## 4. 系统数据结构设计

### 4.1 图层对象结构

系统使用统一的图层对象结构管理各类地理数据：

```javascript
{
    id: "layer_20260123_001",      // String: 图层唯一标识
    name: "黄河湿地边界",           // String: 图层名称
    type: "vector",                // Enum: vector/raster/heatmap
    visible: true,                 // Boolean: 显示状态
    features: 1523,                // Number: 要素数量
    layer: L GeoJSONLayer,         // Object: Leaflet图层实例
    originalData: GeoJSON Object,  // Object: 原始空间数据
    style: {                       // Object: 样式配置
        fillColor: "#3498db",
        color: "#2980b9",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.7
    },
    attributes: [                  // Array: 属性字段列表
        { name: "name", type: "string" },
        { name: "area", type: "number" }
    ],
    optimized: true,               // Boolean: 是否经过优化
    createTime: "2026-01-23"       // String: 创建时间
}
```

### 4.2 数据库表结构

#### 4.2.1 监测数据表（t_monitor_data）

| 字段名 | 数据类型 | 长度 | 允许空 | 说明 |
|--------|----------|------|--------|------|
| id | INTEGER | - | NO | 主键，自增 |
| device_id | VARCHAR | 32 | NO | 设备ID |
| monitor_time | DATETIME | - | NO | 监测时间 |
| lng | DECIMAL | (10,6) | NO | 经度 |
| lat | DECIMAL | (10,6) | NO | 纬度 |
| target_type | VARCHAR | 50 | YES | 目标类型 |
| confidence | DECIMAL | (5,4) | YES | 置信度 |
| image_path | VARCHAR | 255 | YES | 图像路径 |
| description | TEXT | - | YES | 描述信息 |

#### 4.2.2 监测点位表（t_zones）

| 字段名 | 数据类型 | 长度 | 允许空 | 说明 |
|--------|----------|------|--------|------|
| id | INTEGER | - | NO | 主键 |
| zone_name | VARCHAR | 100 | NO | 点位名称 |
| zone_code | VARCHAR | 20 | NO | 点位编码 |
| lng | DECIMAL | (10,6) | NO | 经度 |
| lat | DECIMAL | (10,6) | NO | 纬度 |
| zone_type | INTEGER | - | NO | 点位类型 |
| status | INTEGER | - | NO | 状态：0-离线，1-在线 |
| create_time | DATETIME | - | NO | 创建时间 |

#### 4.2.3 用户信息表（t_users）

| 字段名 | 数据类型 | 长度 | 允许空 | 说明 |
|--------|----------|------|--------|------|
| id | INTEGER | - | NO | 主键 |
| username | VARCHAR | 50 | NO | 用户名 |
| password_hash | VARCHAR | 255 | NO | 密码哈希 |
| email | VARCHAR | 100 | YES | 邮箱 |
| role | INTEGER | - | NO | 角色：0-普通用户，1-管理员 |
| points | INTEGER | - | NO | 积分 |
| create_time | DATETIME | - | NO | 创建时间 |

---

## 5. 关键算法设计

### 5.1 大数据量分块加载算法

#### 5.1.1 算法背景

当数据点数量超过万级时，一次性加载会导致浏览器卡顿甚至崩溃。本系统采用分块加载策略，确保UI线程始终保持响应。

#### 5.1.2 算法实现

```javascript
loadDataAsync(points) {
    const batchSize = 500;  // 每批处理500个点
    let processed = 0;
    
    const processNextBatch = () => {
        const batch = points.slice(processed, processed + batchSize);
        
        if (batch.length === 0) {
            this.finishDataLoading(points);
            return;
        }
        
        this.processBatch(batch, processed);
        processed += batchSize;
        
        const progress = Math.round((processed / points.length) * 100);
        this.updateLoadingProgress(`处理批次 ${Math.ceil(processed / batchSize)}`, 
            `进度: ${progress}% (${processed}/${points.length})`);
        
        // 使用requestAnimationFrame保持UI响应
        requestAnimationFrame(processNextBatch);
    };
    
    processNextBatch();
}
```

#### 5.1.3 算法特点

1. **分批处理**：每批处理固定数量的数据点，避免一次性处理过多数据
2. **异步调度**：使用requestAnimationFrame实现非阻塞加载
3. **进度反馈**：实时更新加载进度，用户可感知处理状态
4. **动态切换**：根据数据量和设置自动选择聚合渲染或热力图渲染

### 5.2 坐标系自动纠偏算法

#### 5.2.1 算法背景

不同来源的GIS数据可能使用不同的坐标系（UTM、Web Mercator、中国常用坐标系等），系统需要自动识别并进行转换。

#### 5.2.2 算法实现

```javascript
async convertProjectedCoordinates(bbox, image) {
    try {
        // 1. 优先使用GeoTIFF中的EPSG编码
        const geoKeys = image.getGeoKeys?.();
        if (geoKeys && geoKeys.ProjectedCSTypeGeoKey) {
            const epsg = this.getEPSGFromGeoKeys(geoKeys);
            if (epsg) {
                return await this.convertWithProj4(bbox, epsg);
            }
        }
        
        // 2. 经验判断：UTM坐标系
        if (bbox[0] >= 100000 && bbox[0] <= 1000000) {
            return this.convertUTMToWGS84(bbox);
        }
        
        // 3. 经验判断：Web Mercator
        if (bbox[0] >= 10000000) {
            return this.convertWebMercatorToWGS84(bbox);
        }
        
        // 默认返回原始坐标
        return bbox;
    } catch (error) {
        console.error('坐标转换失败:', error);
        return null;
    }
}

convertUTMToWGS84(bbox) {
    // UTM转WGS84数学模型
    const centralMeridian = 117;  // 中央经线
    const falseEasting = 500000;  // 假东偏移
    const scale = 0.9996;         // 比例因子
    
    // 坐标转换计算...
    return convertedBbox;
}
```

#### 5.2.3 算法特点

1. **多策略识别**：结合EPSG编码和数值范围双重判断
2. **渐进式转换**：优先精确转换，失败则回退到经验转换
3. **容错处理**：转换失败时提供备用方案，避免程序崩溃
4. **坐标系支持**：支持UTM、Web Mercator、CGCS2000等多种坐标系

### 5.3 Douglas-Peucker几何简化算法

#### 5.3.1 算法原理

Douglas-Peucker算法通过递归方式找出折线中偏离最大的点，保留关键节点以达到简化目的。

#### 5.3.2 算法伪代码

```
function simplify(coords, tolerance):
    if coords.length < 3:
        return coords
    
    // 找到距离起点到终连线最远的点
    maxDistance = 0
    maxIndex = 0
    for i = 1 to coords.length - 2:
        distance = perpendicularDistance(coords[i], coords[0], coords[last])
        if distance > maxDistance:
            maxDistance = distance
            maxIndex = i
    
    // 如果最大距离超过容差，则简化
    if maxDistance > tolerance:
        // 递归简化左右两段
        left = simplify(coords[0..maxIndex], tolerance)
        right = simplify(coords[maxIndex..end], tolerance)
        return left + right[1..]
    else:
        return [coords[0], coords[last]]
```

---

## 6. 接口设计

### 6.1 外部接口

#### 6.1.1 天地图API接口

| 参数名 | 参数值 | 说明 |
|--------|--------|------|
| vec_w | 矢量底图 | 天地图矢量底图服务 |
| img_w | 影像底图 | 天地图影像底图服务 |
| cia_w | 影像标注 | 天地图影像注记层 |

#### 6.1.2 阿里云DataV接口

```
https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json
```

用于获取全国各省市区县行政区划边界数据。

#### 6.1.3 后端数据接口

**GET /api/observations/**

响应示例：
```json
{
    "count": 1234,
    "next": "http://api.example.com/api/observations/?page=2",
    "results": [
        {
            "id": 1,
            "lng": 113.624,
            "lat": 34.746,
            "species": "白鹭",
            "count": 5,
            "observation_time": "2026-01-23T10:30:00Z"
        }
    ]
}
```

**POST /api/observations/**

请求参数（multipart/form-data）：
- image: 文件
- species: 物种ID
- count: 数量
- observation_time: 时间
- lat/lng: 经纬度

### 6.2 内部接口

#### 6.2.1 DataProcessor类静态方法

| 方法名 | 参数 | 返回值 | 功能说明 |
|--------|------|--------|----------|
| simplifyGeometry | geometry, tolerance | Geometry | 几何简化 |
| simplifyCoords | coords, tolerance | Array | 坐标序列简化 |
| distanceToLine | point, start, end | Number | 计算距离 |
| processFeatures | features, options | Promise | 批量处理要素 |
| processLargeDataset | data, options | Promise | 大数据处理 |

#### 6.2.2 QGISStyleProcessor类方法

| 方法名 | 参数 | 返回值 | 功能说明 |
|--------|------|--------|----------|
| parseQML | qmlContent | Object | 解析QML样式 |
| parseGraduatedStyle | qmlContent | Object | 解析分级样式 |
| parseCategorizedStyle | qmlContent | Object | 解析分类样式 |
| parseSimpleStyle | qmlContent | Object | 解析简单样式 |
| applyStyleToLayer | geoJson, styleInfo, attributes | Object | 应用样式 |

---

## 7. 出错处理设计

### 7.1 文件格式校验

系统对上传文件进行多层次校验：

1. **文件类型校验**：仅接受.shp/.dbf/.zip/.tiff/.tif/.geojson等支持格式
2. **文件大小校验**：超过100MB的文件需用户确认后处理
3. **数据完整性校验**：检查Shapefile各组件文件是否完整
4. **格式兼容性校验**：检查数据格式是否符合预期规范

### 7.2 WebGL上下文处理

WebGL上下文可能因以下原因丢失：
- 浏览器切换到后台标签页
- 显卡驱动异常
- 内存不足

处理策略：
```javascript
canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn('WebGL上下文丢失，尝试恢复...');
    setTimeout(() => {
        this.recreateWebGLContext();
    }, 1000);
});

canvas.addEventListener('webglcontextrestored', () => {
    console.log('WebGL上下文已恢复');
    this.reinitializeRender();
});
```

### 7.3 网络请求异常处理

系统采用Axios拦截器统一处理网络异常：

```javascript
// 请求拦截器
request.interceptors.request.use(config => {
    // 添加超时处理
    config.timeout = 10000;
    return config;
}, error => {
    return Promise.reject(error);
});

// 响应拦截器
request.interceptors.response.use(
    response => response,
    error => {
        if (error.code === 'ECONNABORTED') {
            showToast('请求超时，请稍后重试', 'error');
        } else if (error.response && error.response.status === 401) {
            // Token失效，重新登录
            localStorage.removeItem('userToken');
            window.location.href = '/login/';
        } else {
            showToast('网络请求失败: ' + error.message, 'error');
        }
        return Promise.reject(error);
    }
);
```

### 7.4 异常提示机制

系统提供统一的Toast提示组件：

| 方法 | 参数 | 功能说明 |
|------|------|----------|
| showToast | title, message, type | 显示提示信息 |
| showLoading | show, title, subtitle | 显示加载状态 |
| showConfirm | title, message | 显示确认对话框 |

提示类型：success、error、warning、info

---

## 附录

### 附录A：术语表

| 术语 | 说明 |
|------|------|
| B/S架构 | 浏览器/服务器架构 |
| GIS | 地理信息系统 |
| GeoJSON | 地理数据交换格式 |
| Shapefile | ESRI矢量数据格式 |
| GeoTIFF | 带地理信息的TIFF格式 |
| DEM | 数字高程模型 |
| WGS84 | 世界大地坐标系 |
| UTM | 通用横轴墨卡托投影 |
| WebGL | Web图形库 |
| Turf.js | 开源空间分析库 |

### 附录B：参考资料

1. Leaflet官方文档：https://leafletjs.com/
2. QGIS样式格式规范：https://qgis.org/
3. GeoJSON规范：https://geojson.org/
4. Turf.js文档：https://turfjs.org/
5. DETR论文：https://arxiv.org/abs/2005.12872

---

**文档结束**


