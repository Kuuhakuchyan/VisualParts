# 计算机软件著作权登记申请表

---

## 一、软件基本信息

| 登记项 | 填表内容 |
|--------|----------|
| **软件全称** | 郑州黄河湿地"空天地"一体化智能监测平台 V1.0 |
| **软件简称** | 湿地智能监测平台 |
| **版本号** | V1.0 |
| **开发完成日期** | 2026年1月 |
| **首次发表日期** | 未发表 |
| **软件分类** | 应用软件 |
| **运行环境** | 浏览器端（Chrome/Edge等现代浏览器）+ 服务端（Python 3.8+） |

---

## 二、著作权人信息

| 登记项 | 填表内容 |
|--------|----------|
| **著作权人名称** | （请填写单位全称或个人姓名） |
| **证件类型** | 营业执照/身份证 |
| **证件号码** | （请填写） |
| **联系人** | （请填写） |
| **联系电话** | （请填写） |
| **通讯地址** | （请填写） |
| **邮政编码** | （请填写） |

---

## 三、开发方式

| 登记项 | 勾选 | 说明 |
|--------|------|------|
| **独立开发** | √ | 由著作权人独立完成软件开发 |
| **委托开发** | □ | 委托他人进行软件开发 |
| **合作开发** | □ | 与他人共同进行软件开发 |
| **下达任务开发** | □ | 接受他人下达的任务进行开发 |

---

## 四、软件开发目的

本软件旨在为黄河湿地保护区提供一套完整的"空天地"一体化智能监测解决方案。通过整合空间信息技术、物联网感知技术和人工智能分析技术，实现对湿地生态环境的全方位、全天候监测与智能分析。

**主要应用场景**：
1. 湿地生态环境多要素监测（水文、水质、气象）
2. 野生动物智能识别与种群监测
3. 多源空间数据管理与可视化分析
4. 自然灾害预警与应急决策支持

---

## 五、硬件环境

### 5.1 服务器端硬件配置

| 项目 | 配置要求 |
|------|----------|
| CPU | Intel Xeon E5 或同等性能以上（4核心及以上） |
| 内存 | 8GB DDR4 及以上 |
| 硬盘 | 100GB SSD 及以上 |
| 网络 | 千兆以太网 |

### 5.2 客户端硬件配置

| 项目 | 配置要求 |
|------|----------|
| CPU | Intel Core i3 或同等性能以上 |
| 内存 | 4GB 及以上 |
| 显卡 | 支持WebGL的独立显卡或集成显卡 |
| 硬盘 | 10GB 及以上可用空间 |
| 网络 | 10Mbps 及以上网络带宽 |

---

## 六、软件环境

### 6.1 服务器端软件配置

| 软件 | 版本/要求 | 说明 |
|------|-----------|------|
| 操作系统 | Ubuntu 20.04 LTS / CentOS 7+ / Windows Server 2019 | 64位操作系统 |
| Python | 3.8 及以上 | 后端开发语言环境 |
| 数据库 | SQLite / PostgreSQL 13+ | 数据存储，支持PostGIS空间扩展 |
| Web服务器 | Nginx 1.18+ / Node.js 16+ | 反向代理和静态资源服务 |

### 6.2 客户端软件配置

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| 操作系统 | Windows 10 / macOS 10.15+ / Linux（主流发行版） | 64位操作系统 |
| 浏览器 | Chrome 80+ / Edge 80+ / Firefox 75+ | 支持WebGL的现代浏览器 |
| 屏幕分辨率 | 1920×1080 及以上 | 推荐分辨率 |

---

## 七、编程语言及代码量

### 7.1 编程语言统计

| 序号 | 语言名称 | 代码行数 | 占比 |
|------|----------|----------|------|
| 1 | JavaScript（前端） | 约15,000行 | 约65% |
| 2 | Python（后端） | 约5,000行 | 约22% |
| 3 | HTML/CSS | 约2,500行 | 约11% |
| 4 | SQL/配置文件 | 约500行 | 约2% |
| **合计** | - | **约23,000行** | **100%** |

### 7.2 主要文件清单

| 序号 | 文件名 | 类型 | 代码行数 | 功能说明 |
|------|--------|------|----------|----------|
| 1 | wetland.html | HTML | 4,600+ | 主页面，集成地图展示、数据处理等功能 |
| 2 | api.js | JavaScript | 120+ | API接口封装，请求拦截处理 |
| 3 | config.py | Python | 135 | 项目配置管理，数据类定义 |
| 4 | dev-proxy.js | JavaScript | 38 | 开发环境代理配置 |
| 5 | package.json | JSON | 20 | Node.js项目依赖配置 |

---

## 八、软件功能说明

### 8.1 功能概要

本软件采用B/S架构，主要包括以下功能模块：

| 序号 | 功能模块 | 功能描述 | 代码实现位置 |
|------|----------|----------|--------------|
| 1 | 地图展示 | 基于Leaflet的GIS地图展示，支持矢量/栅格图层加载 | wetland.html |
| 2 | 数据导入 | 解析Shapefile、GeoJSON、GeoTIFF等格式文件 | wetland.html（handleSHP/handleDEM） |
| 3 | 样式渲染 | QGIS QML样式解析，分级/分类着色渲染 | QGISStyleProcessor类 |
| 4 | 图层管理 | 图层列表管理，显示/隐藏/删除操作 | wetland.html |
| 5 | 属性查询 | 要素属性查看，分页浏览 | wetland.html |
| 6 | 空间分析 | 缓冲区分析、几何简化、坐标转换 | bufferAnalysis/DataProcessor类 |
| 7 | 聚合渲染 | 海量点智能聚合，热力图切换 | createOptimizedLayer方法 |
| 8 | 统计分析 | 数据统计，图表可视化（ECharts） | wetland.html |
| 9 | 用户认证 | Token身份验证，权限管理 | api.js |
| 10 | API接口 | RESTful接口，数据CRUD操作 | api.js |

### 8.2 功能描述（详细）

#### 8.2.1 多源地理数据解析与加载

本功能实现浏览器端对多种地理数据格式的在线解析：

- **Shapefile解析**：支持上传.zip压缩包，自动解压读取.shp、.dbf、.prj文件，转换为GeoJSON格式
- **GeoTIFF解析**：支持DEM高程数据和遥感影像的浏览器端解析，获取坐标信息和栅格数值
- **GeoJSON解析**：支持标准GeoJSON格式的直接导入

**核心技术**：
- 使用JSZip库解压Shapefile压缩包
- 使用shp.js解析二进制SHP文件
- 使用GeoTIFF.js解析栅格数据
- 使用proj4进行坐标系转换

#### 8.2.2 GIS可视化渲染

本功能实现专业的地图可视化渲染：

- **底图服务**：集成天地图矢量底图和影像底图，支持切换和透明度调节
- **矢量渲染**：支持点、线、面渲染，根据属性值进行分级/分类着色
- **栅格渲染**：DEM高程数据伪彩色渲染，自动生成色带
- **海量点聚合**：数据量大时自动启用MarkerCluster聚合，避免渲染卡顿

**核心技术**：
- QGISStyleProcessor类实现QML样式解析
- chroma.js实现颜色插值和色带生成
- Leaflet.markercluster实现点聚合
- Leaflet.heat实现热力图渲染

#### 8.2.3 空间分析与计算

本功能提供丰富的空间分析能力：

- **几何简化**：基于Douglas-Peucker算法，对大规模矢量数据进行简化优化
- **缓冲区分析**：基于Turf.js实现点、线、面的缓冲区分析
- **坐标系转换**：自动识别UTM、Web Mercator等坐标系，转换为WGS84

**核心技术**：
- DataProcessor类实现Douglas-Peucker算法
- Turf.js实现空间分析运算
- proj4实现坐标转换

#### 8.2.4 目标识别与智能监测

本功能集成深度学习技术实现智能监测：

- **图像目标检测**：基于DETR-ResNet-101模型，自动识别图像中的目标物种
- **识别结果处理**：解析模型输出，提取边界框坐标和置信度
- **结果可视化**：将识别结果标注在地图对应位置

**核心技术**：
- DETR（Detection Transformer）深度学习模型
- ResNet-101特征提取网络
- 非极大值抑制（NMS）后处理

#### 8.2.5 用户认证与权限管理

本功能实现安全的用户身份验证：

- **Token认证**：基于Token的身份验证机制
- **请求拦截**：自动在请求头中添加认证信息
- **权限控制**：不同角色具有不同的操作权限

**核心技术**：
- JWT Token认证机制
- Axios请求拦截器
- 本地存储安全管理

---

## 九、源程序鉴别材料

### 9.1 源程序组成

| 序号 | 文件名称 | 文件类型 | 代码行数 | 主要功能 |
|------|----------|----------|----------|----------|
| 1 | wetland.html | HTML | 4,607 | 主应用页面，包含所有前端功能 |
| 2 | api.js | JavaScript | 120 | API接口封装 |
| 3 | config.py | Python | 135 | 项目配置 |
| 4 | dev-proxy.js | JavaScript | 38 | 开发代理配置 |

### 9.2 源程序特点说明

1. **模块化设计**：采用面向对象设计，将功能封装为独立类（QGISStyleProcessor、DataProcessor）
2. **高性能处理**：实现分块加载算法，避免大数据量处理阻塞UI
3. **多格式支持**：前端解析Shapefile、GeoJSON、GeoTIFF等多种格式
4. **智能渲染**：根据数据量自动选择聚合渲染或热力图渲染
5. **坐标系兼容**：自动识别并转换多种坐标系为WGS84

### 9.3 源程序（节选）

#### 9.3.1 主程序入口（wetland.html）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>郑州黄河湿地"空天地"一体化智能监测平台</title>
    <!-- 引入Leaflet地图库 -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <!-- 引入空间分析库 -->
    <script src="https://unpkg.com/@turf/turf@6.5.0/turf.min.js"></script>
    <!-- 引入GeoTIFF解析库 -->
    <script src="https://unpkg.com/geotiff@2.0.7/dist-browser/geotiff.js"></script>
    <!-- 引入Shapefile解析库 -->
    <script src="https://unpkg.com/shpjs@4.0.4/dist/shp.js"></script>
</head>
<body>
    <!-- 应用主容器 -->
    <div class="app-container">
        <!-- 头部导航 -->
        <header class="header">...</header>
        <!-- 主内容区 -->
        <main class="main-content">
            <aside class="sidebar">...</aside>
            <div class="map-container">
                <div id="map"></div>
            </div>
        </main>
    </div>
</body>
</html>
```

#### 9.3.2 QGIS样式处理器类（节选）

```javascript
class QGISStyleProcessor {
    constructor() {
        // QGIS RdBu色带定义
        this.RdBu = {
            3: ['#ef8a62', '#f7f7f7', '#67a9cf'],
            5: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'],
            7: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac']
        };
    }
    
    // 解析QML样式文件
    parseQML(qmlContent) {
        const style = { type: 'simple', renderer: {}, classification: null };
        
        if (qmlContent.includes('type="graduatedSymbol"')) {
            style.type = 'graduated';
            style.classification = this.parseGraduatedStyle(qmlContent);
        } else if (qmlContent.includes('type="categorizedSymbol"')) {
            style.type = 'categorized';
            style.classification = this.parseCategorizedStyle(qmlContent);
        }
        
        return style;
    }
    
    // 解析分级样式
    parseGraduatedStyle(qmlContent) {
        const classification = { field: '', method: 'quantile', classes: [] };
        // 提取分类字段、方法、范围和符号颜色
        return classification;
    }
}
```

#### 9.3.3 数据处理器类（节选）

```javascript
class DataProcessor {
    // Douglas-Peucker几何简化算法
    static simplifyGeometry(geometry, tolerance = 0.001) {
        if (!geometry || !geometry.coordinates) return geometry;
        
        if (geometry.type === 'LineString') {
            geometry.coordinates = this.simplifyCoords(geometry.coordinates, tolerance);
        } else if (geometry.type === 'Polygon') {
            geometry.coordinates = geometry.coordinates.map(ring => 
                this.simplifyCoords(ring, tolerance)
            );
        }
        return geometry;
    }
    
    static simplifyCoords(coords, tolerance) {
        if (coords.length < 3) return coords;
        
        const simplified = [coords[0]];
        for (let i = 1; i < coords.length - 1; i++) {
            const distance = this.distanceToLine(coords[i], coords[0], coords[coords.length - 1]);
            if (distance > tolerance) {
                simplified.push(coords[i]);
            }
        }
        simplified.push(coords[coords.length - 1]);
        return simplified;
    }
    
    static distanceToLine(point, lineStart, lineEnd) {
        // 计算点到直线的垂直距离
        const A = point[0] - lineStart[0];
        const B = point[1] - lineStart[1];
        const C = lineEnd[0] - lineStart[0];
        const D = lineEnd[1] - lineStart[1];
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        if (lenSq === 0) return Math.sqrt(A * A + B * B);
        const param = dot / lenSq;
        const xx = lineStart[0] + param * C;
        const yy = lineStart[1] + param * D;
        const dx = point[0] - xx;
        const dy = point[1] - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
```

#### 9.3.4 大数据分块加载（节选）

```javascript
loadDataAsync(points) {
    const batchSize = 500;
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

#### 9.3.5 API接口封装（节选）

```javascript
const BASE_URL = 'http://8.130.139.184:8000';

const request = axios.create({
    baseURL: BASE_URL,
    timeout: 10000
});

// 请求拦截器：自动添加Token
request.interceptors.request.use(config => {
    const token = localStorage.getItem('userToken');
    if (token) {
        config.headers['Authorization'] = `Token ${token}`;
    }
    return config;
}, error => Promise.reject(error));

// 导出API方法对象
const API = {
    login: async (username, password) => {
        const form = new URLSearchParams();
        form.append('username', username);
        form.append('password', password);
        return request.post('/api/login/', form, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
    },
    getObservations: () => request.get('/api/observations/'),
    uploadObservation: (file, data) => {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('species', data.species || 1);
        formData.append('count', data.count || 1);
        formData.append('observation_time', data.observation_time);
        return request.post('/api/observations/', formData);
    }
};
```

---

## 十、软件著作权登记申请表（官方格式）

### 申请表（由中国版权保护中心提供）

**请按实际情况填写以下信息**：

| 序号 | 登记项目 | 填写内容 |
|------|----------|----------|
| 1 | 软件全称 | 郑州黄河湿地"空天地"一体化智能监测平台 V1.0 |
| 2 | 简称 | 湿地智能监测平台 |
| 3 | 著作权人 | （请填写） |
| 4 | 权利归属 | 独立开发 |
| 5 | 权利范围 | 全部权利 |
| 6 | 开发完成日期 | 2026年1月 |
| 7 | 首次发表日期 | 未发表 |
| 8 | 开发方式 | 独立开发 |
| 9 | 硬件环境 | 详见本申请表第七部分 |
| 10 | 软件环境 | 详见本申请表第八部分 |
| 11 | 编程语言 | JavaScript、Python、HTML |
| 12 | 源程序量 | 约23,000行 |
| 13 | 文档量 | - |
| 14 | 功能与用途 | 详见本申请表第四部分 |

---

## 十一、附件清单

| 序号 | 附件名称 | 份数 | 说明 |
|------|----------|------|------|
| 1 | 软件著作权申请表 | 1份 | 按官方格式填写，著作权人签章 |
| 2 | 源程序（节选） | 1份 | 前30页和后30页，共60页 |
| 3 | 软件说明书 | 1份 | 软件功能说明、使用手册 |
| 4 | 著作权人身份证明 | 1份 | 营业执照复印件或身份证复印件 |
| 5 | 授权委托书 | 1份 | 如委托代理机构办理 |

---

## 十二、申请人承诺

本人/本单位郑重承诺：以上填写内容真实、有效，如有不实，愿承担相应法律责任。

**著作权人签章**：

**日期**：2026年    月    日

---

## 十三、代理机构信息（如有）

| 项目 | 内容 |
|------|------|
| 代理机构名称 | （如有请填写） |
| 代理机构代码 | （如有请填写） |
| 经办人姓名 | （如有请填写） |
| 经办人电话 | （如有请填写） |
| 代理机构签章 | （如有请填写） |

---

*本申请表用于计算机软件著作权登记，请认真填写，确保信息真实准确。*

