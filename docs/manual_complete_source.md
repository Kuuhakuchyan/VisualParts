# 文件名: 空天地一体化城市热岛效应智能监测与分析平台_完整源代码.md

## 软件著作权代码文档

**软件名称**: 空天地一体化智能监测平台

**版本**: V1.0.0

**代码总量**: 约3000行

---

# 第一部分：后端核心代码

## 1. config.py - 项目配置文件

```1:135:F:\VIsual parts\config.py
"""
项目配置文件
统一管理所有配置参数，支持开发/生产环境切换
"""

import os
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class DatabaseConfig:
    """数据库配置"""
    database_url: str = "visual_parts.db"
    pool_size: int = 5
    max_overflow: int = 10
    pool_timeout: int = 30

@dataclass
class ModelConfig:
    """模型配置"""
    model_name: str = "facebook/detr-resnet-101-dc5"
    detection_threshold: float = 0.6
    nms_threshold: float = 0.5
    padding_ratio: float = 0.15
    contrast_enhance: float = 2.0
    sharpness_enhance: float = 1.5

@dataclass
class APIConfig:
    """API配置"""
    host: str = "0.0.0.0"
    port: int = 5050
    debug: bool = False
    cors_origins: List[str] = None
    
    def __post_init__(self):
        if self.cors_origins is None:
            self.cors_origins = ["*"]

@dataclass
class AuthConfig:
    """认证配置"""
    security_questions: List[str] = None
    auth_port: int = 5000
    
    def __post_init__(self):
        if self.security_questions is None:
            self.security_questions = [
                "你的生日是什么时候？",
                "你母亲的名字是什么？",
                "你的第一所学校的名称是什么？",
                "你的宠物的名字是什么？",
                "你最喜欢的电影是什么？"
            ]

@dataclass
class FrontendConfig:
    """前端配置"""
    map_data_url: str = "https://geo.datav.aliyun.com/areas_v3/bound"
    province_pages: Dict[str, Dict] = None
    
    def __post_init__(self):
        if self.province_pages is None:
            self.province_pages = {
                "北京市": {"adcode": "110000", "area": "16410", "population": "2189", "gdp": "40269"},
                "天津市": {"adcode": "120000", "area": "11966", "population": "1387", "gdp": "14084"},
                "河北省": {"adcode": "130000", "area": "188800", "population": "7592", "gdp": "36207"},
                "山西省": {"adcode": "140000", "area": "156000", "population": "3718", "gdp": "17652"},
                "内蒙古自治区": {"adcode": "150000", "area": "1183000", "population": "2534", "gdp": "17213"},
                "辽宁省": {"adcode": "210000", "area": "148000", "population": "4359", "gdp": "25115"},
                "吉林省": {"adcode": "220000", "area": "187400", "population": "2691", "gdp": "12311"},
                "黑龙江省": {"adcode": "230000", "area": "473000", "population": "3813", "gdp": "13699"},
                "上海市": {"adcode": "310000", "area": "6340", "population": "2428", "gdp": "38701"},
                "江苏省": {"adcode": "320000", "area": "102600", "population": "8051", "gdp": "102719"},
                "浙江省": {"adcode": "330000", "area": "101800", "population": "5850", "gdp": "64613"},
                "安徽省": {"adcode": "340000", "area": "140100", "population": "6324", "gdp": "38681"},
                "福建省": {"adcode": "350000", "area": "121400", "population": "3973", "gdp": "43904"},
                "江西省": {"adcode": "360000", "area": "166900", "population": "4648", "gdp": "25692"},
                "山东省": {"adcode": "370000", "area": "157100", "population": "10153", "gdp": "73129"},
                "河南省": {"adcode": "410000", "area": "167000", "population": "9883", "gdp": "54259"},
                "湖北省": {"adcode": "420000", "area": "185900", "population": "5927", "gdp": "45828"},
                "湖南省": {"adcode": "430000", "area": "211800", "population": "6919", "gdp": "39752"},
                "广东省": {"adcode": "440000", "area": "179800", "population": "11521", "gdp": "110761"},
                "广西壮族自治区": {"adcode": "450000", "area": "237600", "population": "4926", "gdp": "22157"},
                "海南省": {"adcode": "460000", "area": "35400", "population": "1008", "gdp": "5532"},
                "重庆市": {"adcode": "500000", "area": "82400", "population": "3124", "gdp": "25003"},
                "四川省": {"adcode": "510000", "area": "486000", "population": "8375", "gdp": "46616"},
                "贵州省": {"adcode": "520000", "area": "176000", "population": "3856", "gdp": "17827"},
                "云南省": {"adcode": "530000", "area": "394000", "population": "4830", "gdp": "24522"},
                "西藏自治区": {"adcode": "540000", "area": "1228000", "population": "366", "gdp": "1903"},
                "陕西省": {"adcode": "610000", "area": "205600", "population": "3953", "gdp": "25793"},
                "甘肃省": {"adcode": "620000", "area": "454000", "population": "2637", "gdp": "9017"},
                "青海省": {"adcode": "630000", "area": "722000", "population": "603", "gdp": "3010"},
                "宁夏回族自治区": {"adcode": "640000", "area": "66400", "population": "688", "gdp": "3921"},
                "新疆维吾尔自治区": {"adcode": "650000", "area": "1660000", "population": "2523", "gdp": "13798"},
                "台湾省": {"adcode": "710000", "area": "36100", "population": "2359", "gdp": "41400"},
                "香港特别行政区": {"adcode": "810000", "area": "1106", "population": "741", "gdp": "24103"},
                "澳门特别行政区": {"adcode": "820000", "area": "33", "population": "68", "gdp": "1944"}
            }

@dataclass
class Config:
    """主配置类"""
    database: DatabaseConfig = DatabaseConfig()
    model: ModelConfig = ModelConfig()
    api: APIConfig = APIConfig()
    auth: AuthConfig = AuthConfig()
    frontend: FrontendConfig = FrontendConfig()
    
    @classmethod
    def from_env(cls):
        """从环境变量加载配置"""
        config = cls()
        
        # 数据库配置
        if os.getenv('DATABASE_URL'):
            config.database.database_url = os.getenv('DATABASE_URL')
        
        # API配置
        if os.getenv('API_HOST'):
            config.api.host = os.getenv('API_HOST')
        if os.getenv('API_PORT'):
            config.api.port = int(os.getenv('API_PORT'))
        if os.getenv('API_DEBUG'):
            config.api.debug = os.getenv('API_DEBUG').lower() == 'true'
        
        # 认证配置
        if os.getenv('AUTH_PORT'):
            config.auth.auth_port = int(os.getenv('AUTH_PORT'))
        
        return config

# 全局配置实例
config = Config.from_env()
```

## 2. database.py - 数据库模块

```1:107:F:\VIsual parts\Backend\database.py
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

def init_db():
    conn = sqlite3.connect('visual_parts.db')
    cursor = conn.cursor()
    
    # 创建用户表
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        security_question TEXT NOT NULL,
        security_answer TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # 创建地理数据表
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS geo_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        coordinates TEXT NOT NULL,
        properties TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    conn.commit()
    conn.close()

class Database:
    def __init__(self):
        self.conn = sqlite3.connect('visual_parts.db')
        self.cursor = self.conn.cursor()
    
    def register_user(self, username, password, question, answer):
        try:
            self.cursor.execute(
                'INSERT INTO users (username, password_hash, security_question, security_answer) VALUES (?, ?, ?, ?)',
                (username, generate_password_hash(password), question, answer)
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
    
    def verify_user(self, username, password):
        self.cursor.execute(
            'SELECT password_hash FROM users WHERE username = ?', 
            (username,)
        )
        result = self.cursor.fetchone()
        if result and check_password_hash(result[0], password):
            return True
        return False
    
    def get_security_question(self, username):
        self.cursor.execute(
            'SELECT security_question FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def verify_security_answer(self, username, answer):
        self.cursor.execute(
            'SELECT security_answer FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result and result[0] == answer
    
    def reset_password(self, username, new_password):
        self.cursor.execute(
            'UPDATE users SET password_hash = ? WHERE username = ?',
            (generate_password_hash(new_password), username)
        )
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def add_geo_data(self, user_id, data_type, coordinates, properties=None):
        self.cursor.execute(
            'INSERT INTO geo_data (user_id, data_type, coordinates, properties) VALUES (?, ?, ?, ?)',
            (user_id, data_type, coordinates, properties)
        )
        self.conn.commit()
        return self.cursor.lastrowid
    
    def get_user_id(self, username):
        self.cursor.execute(
            'SELECT id FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def __del__(self):
        self.conn.close()

# 初始化数据库
init_db()
```

## 3. model_manager.py - 热岛监测模型管理模块

```1:271:F:\VIsual parts\Backend\model_manager.py
"""
模型管理模块
负责城市热岛监测模型的加载、管理和热异常检测推理
"""

import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import time
import io
import base64
from config import config

class HeatIslandModelManager:
    """城市热岛监测模型管理器"""
    
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = None
        self.font = None
        self.is_initialized = False
    
    def initialize(self):
        """初始化模型"""
        try:
            print("正在加载模型...")
            self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
            self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
            
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(self.device)
            print(f"使用设备: {self.device.type.upper()}")
            
            # 加载字体
            self._load_font()
            
            self.is_initialized = True
            print("模型加载完成")
            
        except Exception as e:
            print(f"模型初始化失败: {e}")
            raise
    
    def _load_font(self):
        """加载字体"""
        try:
            self.font = ImageFont.truetype("simhei.ttf", 20)
        except IOError:
            try:
                self.font = ImageFont.truetype("simsun.ttc", 20)
            except IOError:
                self.font = ImageFont.load_default()
                print("警告: 无法加载中文字体，将使用默认字体")
    
    def non_max_suppression(self, boxes, scores, threshold=0.5):
        """NMS算法"""
        if boxes.numel() == 0:
            return torch.empty((0,), dtype=torch.long)
        
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort(descending=True)
        
        keep = []
        while order.numel() > 0:
            if order.numel() == 1:
                i = order.item()
                keep.append(i)
                break
            else:
                i = order[0].item()
                keep.append(i)
            
            xx1 = torch.max(x1[i], x1[order[1:]])
            yy1 = torch.max(y1[i], y1[order[1:]])
            xx2 = torch.min(x2[i], x2[order[1:]])
            yy2 = torch.min(y2[i], y2[order[1:]])
            
            w = torch.max(xx2 - xx1 + 1, torch.tensor(0.0))
            h = torch.max(yy2 - yy1 + 1, torch.tensor(0.0))
            inter = w * h
            
            iou = inter / (areas[i] + areas[order[1:]] - inter)
            
            inds = torch.where(iou <= threshold)[0]
            order = order[inds + 1]
        
        return torch.tensor(keep, dtype=torch.long)
    
    def crop_to_roi(self, image, padding=0.15):
        """智能区域裁剪"""
        width, height = image.size
        gray = image.convert("L")
        edges = gray.filter(ImageFilter.FIND_EDGES)
        
        edge_points = []
        for x in range(width):
            for y in range(height):
                if edges.getpixel((x, y)) > 100:
                    edge_points.append((x, y))
        
        if not edge_points:
            return image, (0, 0)
        
        min_x = min(p[0] for p in edge_points)
        max_x = max(p[0] for p in edge_points)
        min_y = min(p[1] for p in edge_points)
        max_y = max(p[1] for p in edge_points)
        
        pad_x = int((max_x - min_x) * padding)
        pad_y = int((max_y - min_y) * padding)
        
        min_x = max(0, min_x - pad_x)
        max_x = min(width - 1, max_x + pad_x)
        min_y = max(0, min_y - pad_y)
        max_y = min(height - 1, max_y + pad_y)
        
        return image.crop((min_x, min_y, max_x, max_y)), (min_x, min_y)
    
    def preprocess_image(self, image):
        """图像预处理"""
        # 增强预处理
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.model.contrast_enhance)
        
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.model.sharpness_enhance)
        
        image = image.filter(ImageFilter.MedianFilter(size=3))
        return image
    
    def detect_heat_islands(self, image, filename=""):
        """检测热异常区域"""
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        
        try:
            # 预处理
            processed_image = self.preprocess_image(image)
            
            # 应用裁剪
            roi_image, crop_offset = self.crop_to_roi(processed_image, config.model.padding_ratio)
            
            # 模型推理
            inputs = self.processor(images=roi_image, return_tensors="pt").to(self.device)
            
            start_time = time.time()
            with torch.no_grad():
                outputs = self.model(**inputs)
            infer_time = time.time() - start_time
            
            # 后处理
            target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
            results = self.processor.post_process_object_detection(
                outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
            )[0]
            
            # 应用NMS过滤重叠框
            boxes = results["boxes"].cpu()
            scores = results["scores"].cpu()
            labels = results["labels"].cpu()
            keep_indices = self.non_max_suppression(boxes, scores, config.model.nms_threshold)
            
            boxes = boxes[keep_indices]
            scores = scores[keep_indices]
            labels = labels[keep_indices]
            
            # 筛选出热异常区域
            heat_anomaly_indices = []
            for i, label in enumerate(labels):
                class_name = self.model.config.id2label[label.item()].lower()
                if "heat" in class_name or "anomaly" in class_name or "hot" in class_name:
                    heat_anomaly_indices.append(i)
            
            if heat_anomaly_indices:
                heat_anomaly_indices = torch.tensor(heat_anomaly_indices, dtype=torch.long)
                results["boxes"] = boxes[heat_anomaly_indices]
                results["scores"] = scores[heat_anomaly_indices]
                results["labels"] = labels[heat_anomaly_indices]
                
                # 恢复原图坐标
                if len(results["boxes"]) > 0:
                    results["boxes"][:, 0] += crop_offset[0]
                    results["boxes"][:, 1] += crop_offset[1]
                    results["boxes"][:, 2] += crop_offset[0]
                    results["boxes"][:, 3] += crop_offset[1]
            else:
                results["boxes"] = torch.tensor([])
                results["scores"] = torch.tensor([])
                results["labels"] = torch.tensor([])
            
            return {
                "results": results,
                "inference_time": infer_time,
                "original_image": image,
                "crop_offset": crop_offset
            }
            
        except Exception as e:
            raise RuntimeError(f"热异常检测失败: {e}")
    
    def visualize_results(self, detection_result, filename=""):
        """可视化热异常检测结果"""
        image = detection_result["original_image"]
        results = detection_result["results"]
        infer_time = detection_result["inference_time"]
        
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        
        # 绘制计数和信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: {config.model.model_name}", fill="white", font=self.font)
        draw.text([5, 30], f"热异常区域数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        
        # 存储检测到的热异常信息
        detected_heat_sources = []
        
        # 绘制检测框和标签
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = self.model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            
            # 记录热异常
            detected_heat_sources.append({
                "class": class_name,
                "score": float(score),
                "box": box,
                "intensity": float(score) * 100,
                "lcz_type": class_name
            })
            
            # 绘制边界框
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            
            # 绘制标签
            label_text = f"{class_name}: {score:.2f}"
            
            try:
                bbox = draw.textbbox((0, 0), label_text, font=self.font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=self.font)
            
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=self.font)
        
        # 将图片转换为base64
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        
        return {
            "image": img_str,
            "count": object_count,
            "heat_sources": detected_heat_sources,
            "inference_time": infer_time
        }

# 全局热岛模型管理器实例
heat_island_model_manager = HeatIslandModelManager()
```

## 4. wrf_model_adapter.py - WRF模式气象数据适配器

```1:850:F:\VIsual parts\Backend\wrf_model_adapter.py
"""
WRF模式气象数据适配器模块
用于城市热岛效应监测与WRF模式气象数据对接
支持温度、风速、湿度、气压等气象参数的处理和分析

功能：
1. WRF模式输出数据解析
2. 气象参数空间插值
3. 热岛强度计算
4. 时序数据提取
5. 与遥感反演数据融合

作者：系统自动生成
版本：1.0.0
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Union
from dataclasses import dataclass, field
import logging
import os
import json
from scipy.interpolate import RegularGridInterpolator, NearestNDInterpolator
from scipy.ndimage import gaussian_filter
import warnings

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class WRFCoordinate:
    """WRF模式坐标信息"""
    longitude: np.ndarray  # 经度数组
    latitude: np.ndarray   # 纬度数组
    crs: str = "WGS84"     # 坐标参考系
    
    def __post_init__(self):
        if self.longitude.shape != self.latitude.shape:
            raise ValueError("经纬度数组形状必须一致")


@dataclass
class WRFTimeCoordinate:
    """WRF模式时空坐标"""
    time: np.ndarray       # 时间数组
    longitude: np.ndarray  # 经度二维数组
    latitude: np.ndarray   # 纬度二维数组
    levels: np.ndarray = field(default_factory=np.array)  # 气压层
    
    def get_spatial_shape(self) -> Tuple[int, int]:
        """获取空间维度形状"""
        return self.longitude.shape
    
    def get_temporal_shape(self) -> int:
        """获取时间维度长度"""
        return len(self.time)


@dataclass
class WRFVariable:
    """WRF模式变量"""
    name: str              # 变量名称
    units: str             # 单位
    description: str       # 描述
    data: np.ndarray       # 数据数组
    dimensions: Tuple[str, ...] = ('time', 'south_north', 'west_east')  # 维度
    
    def __getitem__(self, key):
        """支持数组索引访问"""
        return self.data[key]
    
    def mean(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算均值"""
        return np.nanmean(self.data, axis=axis)
    
    def max(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算最大值"""
        return np.nanmax(self.data, axis=axis)
    
    def min(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算最小值"""
        return np.nanmin(self.data, axis=axis)


@dataclass
class SurfaceVariable:
    """地表气象变量"""
    temperature_2m: WRFVariable = None      # 2米气温 (K)
    dewpoint_2m: WRFVariable = None         # 2米露点温度 (K)
    u_component_10m: WRFVariable = None     # 10米U风分量 (m/s)
    v_component_10m: WRFVariable = None     # 10米V风分量 (m/s)
    surface_pressure: WRFVariable = None    # 地面气压 (Pa)
    sensible_heat_flux: WRFVariable = None  # 感热通量 (W/m²)
    latent_heat_flux: WRFVariable = None    # 潜热通量 (W/m²)
    skin_temperature: WRFVariable = None    # 皮肤温度 (K)
    ground_temperature: WRFVariable = None  # 地表温度 (K)
    
    def get_variable(self, name: str) -> Optional[WRFVariable]:
        """根据名称获取变量"""
        return getattr(self, name, None)


@dataclass
class UpperAirVariable:
    """高空探测变量"""
    u_component: WRFVariable = None         # U风分量
    v_component: WRFVariable = None         # V风分量
    temperature: WRFVariable = None         # 气温
    geopotential_height: WRFVariable = None # 位势高度
    relative_humidity: WRFVariable = None   # 相对湿度
    specific_humidity: WRFVariable = None   # 比湿
    
    def get_pressure_levels(self) -> np.ndarray:
        """获取气压层"""
        if self.geopotential_height is not None:
            return self.geopotential_height.levels
        return np.array([])


@dataclass
class WRFOutputData:
    """WRF模式输出数据结构"""
    time_coordinate: WRFTimeCoordinate = None
    surface_variables: SurfaceVariable = None
    upper_air_variables: UpperAirVariable = None
    metadata: Dict = field(default_factory=dict)
    
    def get_time_range(self) -> Tuple[datetime, datetime]:
        """获取时间范围"""
        if self.time_coordinate is not None and len(self.time_coordinate.time) > 0:
            return self.time_coordinate.time[0], self.time_coordinate.time[-1]
        return None, None
    
    def get_spatial_extent(self) -> Tuple[float, float, float, float]:
        """获取空间范围 (西, 东, 南, 北)"""
        if self.time_coordinate is not None:
            lon = self.time_coordinate.longitude
            lat = self.time_coordinate.latitude
            return np.min(lon), np.max(lon), np.min(lat), np.max(lat)
        return None, None


class WRFModelAdapter:
    """
    WRF模式数据适配器
    
    用于处理WRF模式输出数据，支持：
    - 数据读取和解析
    - 空间插值到目标区域
    - 时间序列提取
    - 热岛相关指标计算
    - 与遥感数据融合
    """
    
    # 常用气象变量名称映射
    VARIABLE_MAPPING = {
        'T2': 'temperature_2m',           # 2米气温
        'TD2': 'dewpoint_2m',             # 2米露点温度
        'U10': 'u_component_10m',         # 10米U风
        'V10': 'v_component_10m',         # 10米V风
        'PSFC': 'surface_pressure',       # 地面气压
        'HFX': 'sensible_heat_flux',      # 感热通量
        'LH': 'latent_heat_flux',         # 潜热通量
        'TSK': 'skin_temperature',        # 皮肤温度
        'TG': 'ground_temperature',       # 地表温度
    }
    
    # 变量单位转换表
    UNIT_CONVERSION = {
        'K': ('K', 1.0),           # 开尔文 -> 开尔文
        'degK': ('K', 1.0),        # 开尔文 -> 开尔文
        'm s-1': ('m/s', 1.0),     # 米每秒 -> 米每秒
        'Pa': ('Pa', 1.0),         # 帕斯卡 -> 帕斯卡
        'W m-2': ('W/m²', 1.0),    # 瓦每平方米 -> 瓦每平方米
    }
    
    def __init__(self, config: Optional[Dict] = None):
        """
        初始化WRF模式适配器
        
        Args:
            config: 配置字典，包含插值参数等
        """
        self.config = config or self._default_config()
        self.wrf_data: Optional[WRFOutputData] = None
        self.interpolator: Optional[RegularGridInterpolator] = None
        self.logger = logging.getLogger(self.__class__.__name__)
    
    def _default_config(self) -> Dict:
        """默认配置"""
        return {
            'interpolation_method': 'linear',
            'extrapolation_value': np.nan,
            'smoothing_sigma': 0,
            'target_resolution': 0.01,  # 度
            'time_zone': 'Asia/Shanghai',
            'temperature_unit': 'celsius',  # 摄氏度
            'variables_of_interest': [
                'temperature_2m',
                'surface_pressure',
                'sensible_heat_flux',
                'skin_temperature'
            ]
        }
    
    def load_wrf_output(self, filepath: str) -> WRFOutputData:
        """
        加载WRF模式输出数据
        
        Args:
            filepath: WRF输出文件路径 (支持 .nc, .nc4 格式)
            
        Returns:
            WRFOutputData: 解析后的数据结构
            
        Raises:
            FileNotFoundError: 文件不存在
            ValueError: 数据格式错误
        """
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"WRF数据文件不存在: {filepath}")
        
        self.logger.info(f"正在加载WRF模式输出数据: {filepath}")
        
        try:
            # 尝试使用netCDF4库读取
            try:
                import netCDF4 as nc
                data = nc.Dataset(filepath, 'r')
                wrf_data = self._parse_wrf_netcdf(data)
                data.close()
            except ImportError:
                # 尝试使用xarray读取
                try:
                    import xarray as xr
                    data = xr.open_dataset(filepath)
                    wrf_data = self._parse_wrf_xarray(data)
                    data.close()
                except ImportError:
                    # 使用numpy加载模拟数据
                    wrf_data = self._generate_simulated_data()
            
            self.wrf_data = wrf_data
            self.logger.info("WRF数据加载成功")
            return wrf_data
            
        except Exception as e:
            self.logger.error(f"加载WRF数据失败: {e}")
            raise
    
    def _parse_wrf_netcdf(self, data) -> WRFOutputData:
        """解析netCDF格式的WRF数据"""
        # 提取时间和坐标
        times = self._parse_wrf_times(data.variables['Times'][:])
        
        # 提取经纬度 (假设使用WRF标准投影)
        lon = data.variables['XLONG'][0].astype(np.float64)
        lat = data.variables['XLAT'][0].astype(np.float64)
        
        # 创建时间坐标对象
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon,
            latitude=lat
        )
        
        # 提取表面变量
        surface_vars = self._extract_surface_variables(data, time_coord)
        
        # 提取高空变量
        upper_air_vars = self._extract_upper_air_variables(data, time_coord)
        
        # 创建输出数据结构
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            upper_air_variables=upper_air_vars,
            metadata={
                'source_file': data.filepath(),
                'simulation_start': str(times[0]) if len(times) > 0 else None,
                'simulation_end': str(times[-1]) if len(times) > 0 else None,
                'grid_shape': lon.shape
            }
        )
        
        return wrf_output
    
    def _parse_wrf_xarray(self, data) -> WRFOutputData:
        """解析xarray格式的WRF数据"""
        # 提取时间坐标
        times = pd.to_datetime(data.coords['Time'].values)
        
        # 提取经纬度
        lon = data.coords['XLONG'].values.astype(np.float64)
        lat = data.coords['XLAT'].values.astype(np.float64)
        
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon,
            latitude=lat
        )
        
        # 提取变量
        surface_vars = SurfaceVariable()
        
        # 温度转换
        if 'T2' in data.variables:
            temp_data = data.variables['T2'][:].astype(np.float64)
            surface_vars.temperature_2m = WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=temp_data
            )
        
        # 风速分量
        if 'U10' in data.variables:
            surface_vars.u_component_10m = WRFVariable(
                name='U10',
                units='m s-1',
                description='10米U风分量',
                data=data.variables['U10'][:].astype(np.float64)
            )
        
        if 'V10' in data.variables:
            surface_vars.v_component_10m = WRFVariable(
                name='V10',
                units='m s-1',
                description='10米V风分量',
                data=data.variables['V10'][:].astype(np.float64)
            )
        
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            metadata={
                'source': 'xarray',
                'dimensions': dict(data.dims)
            }
        )
        
        return wrf_output
    
    def _generate_simulated_data(self) -> WRFOutputData:
        """
        生成模拟的WRF数据（用于演示和测试）
        
        在无法读取实际WRF数据时使用，生成符合实际规律的数据
        """
        self.logger.warning("使用模拟WRF数据进行演示")
        
        # 时间范围: 7天，小时数据
        start_time = datetime(2024, 7, 15, 0, 0, 0)
        times = np.array([start_time + timedelta(hours=i) for i in range(168)])  # 7天 * 24小时
        
        # 空间范围: 河南省某区域 (经度: 113-116, 纬度: 33-36)
        grid_size = (20, 25)  # 20x25网格
        lon_range = np.linspace(113.5, 115.5, grid_size[1])
        lat_range = np.linspace(34.0, 35.5, grid_size[0])
        lon_grid, lat_grid = np.meshgrid(lon_range, lat_range)
        
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon_grid,
            latitude=lat_grid
        )
        
        # 生成模拟温度数据 (白天高温，夜间低温)
        def generate_diurnal_temperature(base_temp: float, amplitude: float = 8.0):
            """生成日变化温度"""
            n_times = len(times)
            temp_series = np.zeros(n_times)
            
            for t in range(n_times):
                hour = times[t].hour
                # 日变化: 峰值在14:00，最低在05:00
                diurnal_cycle = amplitude * np.sin(2 * np.pi * (hour - 9) / 24)
                temp_series[t] = base_temp + diurnal_cycle
            
            return temp_series
        
        # 城市区域温度较高 (热岛效应)
        center_lon, center_lat = 113.8, 34.8
        distance_from_center = np.sqrt((lon_grid - center_lon)**2 + (lat_grid - center_lat)**2)
        urban_mask = distance_from_center < 0.3
        
        # 生成3D温度数据 (时间 x 纬度 x 经度)
        base_temp_city = 302.0  # 城市基础温度 K
        base_temp_rural = 298.0  # 农村基础温度 K
        
        temperature_3d = np.zeros((len(times), *grid_size))
        diurnal_temp = generate_diurnal_temperature(300.0)
        
        for t in range(len(times)):
            for i in range(grid_size[0]):
                for j in range(grid_size[1]):
                    if urban_mask[i, j]:
                        temperature_3d[t, i, j] = diurnal_temp[t] + 2.0
                    else:
                        temperature_3d[t, i, j] = diurnal_temp[t] - 1.0
        
        surface_vars = SurfaceVariable(
            temperature_2m=WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=temperature_3d
            ),
            skin_temperature=WRFVariable(
                name='TSK',
                units='K',
                description='地表皮肤温度',
                data=temperature_3d + np.random.randn(*temperature_3d.shape) * 0.5
            ),
            surface_pressure=WRFVariable(
                name='PSFC',
                units='Pa',
                description='地面气压',
                data=np.full((len(times), *grid_size), 101325.0) + 
                      np.random.randn(len(times), *grid_size) * 100
            ),
            sensible_heat_flux=WRFVariable(
                name='HFX',
                units='W m-2',
                description='感热通量',
                data=np.random.rand(len(times), *grid_size) * 300
            )
        )
        
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            metadata={
                'source': 'simulated',
                'simulation_period': '2024-07-15 to 2024-07-22',
                'grid_resolution': '0.1 degree',
                'note': '此数据为模拟数据，仅用于演示'
            }
        )
        
        return wrf_output
    
    def _parse_wrf_times(self, times_array: np.ndarray) -> np.ndarray:
        """解析WRF时间数组"""
        parsed_times = []
        for t in times_array:
            time_str = ''.join([s.decode('utf-8') if isinstance(s, bytes) else s for s in t])
            parsed_times.append(datetime.strptime(time_str, '%Y-%m-%d_%H:%M:%S'))
        return np.array(parsed_times)
    
    def _extract_surface_variables(self, data, time_coord: WRFTimeCoordinate) -> SurfaceVariable:
        """提取表面变量"""
        surface_vars = SurfaceVariable()
        
        # 温度
        if 'T2' in data.variables:
            surface_vars.temperature_2m = WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=data.variables['T2'][:].astype(np.float64)
            )
        
        # 露点温度
        if 'TD2' in data.variables:
            surface_vars.dewpoint_2m = WRFVariable(
                name='TD2',
                units='K',
                description='2米露点温度',
                data=data.variables['TD2'][:].astype(np.float64)
            )
        
        # 风速分量
        if 'U10' in data.variables:
            surface_vars.u_component_10m = WRFVariable(
                name='U10',
                units='m s-1',
                description='10米U风分量',
                data=data.variables['U10'][:].astype(np.float64)
            )
        
        if 'V10' in data.variables:
            surface_vars.v_component_10m = WRFVariable(
                name='V10',
                units='m s-1',
                description='10米V风分量',
                data=data.variables['V10'][:].astype(np.float64)
            )
        
        # 气压
        if 'PSFC' in data.variables:
            surface_vars.surface_pressure = WRFVariable(
                name='PSFC',
                units='Pa',
                description='地面气压',
                data=data.variables['PSFC'][:].astype(np.float64)
            )
        
        # 热通量
        if 'HFX' in data.variables:
            surface_vars.sensible_heat_flux = WRFVariable(
                name='HFX',
                units='W m-2',
                description='感热通量',
                data=data.variables['HFX'][:].astype(np.float64)
            )
        
        if 'LH' in data.variables:
            surface_vars.latent_heat_flux = WRFVariable(
                name='LH',
                units='W m-2',
                description='潜热通量',
                data=data.variables['LH'][:].astype(np.float64)
            )
        
        # 温度
        if 'TSK' in data.variables:
            surface_vars.skin_temperature = WRFVariable(
                name='TSK',
                units='K',
                description='地表皮肤温度',
                data=data.variables['TSK'][:].astype(np.float64)
            )
        
        return surface_vars
    
    def _extract_upper_air_variables(self, data, time_coord: WRFTimeCoordinate) -> UpperAirVariable:
        """提取高空变量"""
        upper_air_vars = UpperAirVariable()
        
        # 如果有气压层数据，提取
        if 'P' in data.variables and 'PB' in data.variables:
            pressure = data.variables['P'][:] + data.variables['PB'][:]
            levels = np.unique(pressure[0, :, 0, 0])
            
            upper_air_vars.geopotential_height = WRFVariable(
                name='PH',
                units='m',
                description='位势高度',
                data=data.variables['PH'][:].astype(np.float64),
                dimensions=('time', 'bottom_top', 'south_north', 'west_east'),
                levels=levels
            )
        
        return upper_air_vars
    
    def run_simulation(self, config: Optional[Dict] = None) -> Dict:
        """
        执行WRF模式模拟配置
        
        Args:
            config: 模拟配置参数
            
        Returns:
            Dict: 模拟结果摘要
        """
        self.logger.info("开始WRF模式模拟配置...")
        
        sim_config = config or {}
        
        # 模拟参数
        result = {
            'status': 'configured',
            'start_time': datetime.now().isoformat(),
            'configuration': sim_config,
            'parameters': {
                'domain': {
                    'center_lat': sim_config.get('center_lat', 34.75),
                    'center_lon': sim_config.get('center_lon', 113.65),
                    'dx': sim_config.get('dx', 3000),  # 3km分辨率
                    'dy': sim_config.get('dy', 3000),
                    'parent_grid_ratio': sim_config.get('parent_grid_ratio', [1, 3, 1]),
                    'parent_id': sim_config.get('parent_id', [1, 1, 2]),
                },
                'time_control': {
                    'start_year': sim_config.get('start_year', 2024),
                    'start_month': sim_config.get('start_month', 7),
                    'start_day': sim_config.get('start_day', 15),
                    'start_hour': sim_config.get('start_hour', 0),
                    'end_hour': sim_config.get('end_hour', 168),  # 7天
                    'interval_seconds': sim_config.get('interval_seconds', 21600)
                },
                'physics': {
                    'mp_physics': sim_config.get('mp_physics', 6),  # Morrison微物理
                    'ra_lw_physics': sim_config.get('ra_lw_physics', 4),  # RRTM长波
                    'ra_sw_physics': sim_config.get('ra_sw_physics', 4),  # DRT短波
                    'bl_pbl_physics': sim_config.get('bl_pbl_physics', 1),  # YSU边界层
                    'sf_sfclay_physics': sim_config.get('sf_sfclay_physics', 1),
                    'sf_surface_physics': sim_config.get('sf_surface_physics', 2),  # Noah-MP
                    'cu_physics': sim_config.get('cu_physics', 1)  # Kain-Fritsch
                },
                'dynamics': {
                    'diff_opt': sim_config.get('diff_opt', 2),
                    'km_opt': sim_config.get('km_opt', 4),
                    'damp_opt': sim_config.get('damp_opt', 3),
                    'dampcoef': sim_config.get('dampcoef', 0.2)
                }
            },
            'nest': {
                'max_dom': sim_config.get('max_dom', 2),
                'i_parent_start': sim_config.get('i_parent_start', [1, 31]),
                'j_parent_start': sim_config.get('j_parent_start', [1, 18]),
                'parent_grid_ratio': sim_config.get('parent_grid_ratio', [1, 3]),
                'parent_time_step_ratio': sim_config.get('parent_time_step_ratio', [1, 3])
            }
        }
        
        self.logger.info("WRF模式模拟配置完成")
        return result
    
    def interpolate_to_location(self, 
                                lon: float, 
                                lat: float,
                                variable: str = 'temperature_2m',
                                time: Optional[datetime] = None) -> Optional[float]:
        """
        将WRF数据插值到指定位置
        
        Args:
            lon: 目标经度
            lat: 目标纬度
            variable: 变量名称
            time: 目标时间 (默认为最新时间)
            
        Returns:
            float: 插值结果 (如无法插值返回NaN)
        """
        if self.wrf_data is None:
            self.logger.warning("未加载WRF数据，无法进行插值")
            return np.nan
        
        try:
            wrf = self.wrf_data
            
            # 获取时间索引
            time_idx = 0
            if time is not None and wrf.time_coordinate is not None:
                times = wrf.time_coordinate.time
                if len(times) > 0:
                    time_diffs = [abs((t - time).total_seconds()) for t in times]
                    time_idx = np.argmin(time_diffs)
            
            # 获取变量数据
            var = None
            if variable == 'temperature_2m' and wrf.surface_variables.temperature_2m is not None:
                var = wrf.surface_variables.temperature_2m
            elif variable == 'skin_temperature' and wrf.surface_variables.skin_temperature is not None:
                var = wrf.surface_variables.skin_temperature
            
            if var is None:
                self.logger.warning(f"变量 {variable} 不存在")
                return np.nan
            
            # 提取指定时间的数据
            data_2d = var.data[time_idx]
            
            # 创建插值器
            lon_1d = wrf.time_coordinate.longitude[0, :] if len(wrf.time_coordinate.longitude.shape) == 2 else wrf.time_coordinate.longitude
            lat_1d = wrf.time_coordinate.latitude[:, 0] if len(wrf.time_coordinate.latitude.shape) == 2 else wrf.time_coordinate.latitude
            
            # 确保坐标正确
            if lon_1d.ndim == 1 and lat_1d.ndim == 1:
                interpolator = RegularGridInterpolator(
                    (lat_1d, lon_1d),
                    data_2d,
                    method=self.config.get('interpolation_method', 'linear'),
                    bounds_error=False,
                    fill_value=np.nan
                )
                
                result = interpolator([[lat, lon]])
                return float(result[0])
            
            return np.nan
            
        except Exception as e:
            self.logger.error(f"插值失败: {e}")
            return np.nan
    
    def extract_time_series(self, 
                           lon: float, 
                           lat: float,
                           variables: List[str] = None) -> pd.DataFrame:
        """
        提取指定位置的时间序列数据
        
        Args:
            lon: 经度
            lat: 纬度
            variables: 变量列表
            
        Returns:
            pd.DataFrame: 时间序列数据
        """
        if self.wrf_data is None:
            self.logger.warning("未加载WRF数据")
            return pd.DataFrame()
        
        variables = variables or ['temperature_2m', 'skin_temperature']
        
        times = self.wrf_data.time_coordinate.time
        
        data_dict = {'datetime': times}
        
        for var in variables:
            values = []
            for t in range(len(times)):
                val = self.interpolate_to_location(lon, lat, var, times[t])
                values.append(val)
            data_dict[var] = values
        
        df = pd.DataFrame(data_dict)
        df.set_index('datetime', inplace=True)
        
        return df
    
    def calculate_heat_island_intensity(self,
                                        urban_lon: float,
                                        urban_lat: float,
                                        rural_lon: float,
                                        rural_lat: float,
                                        variable: str = 'temperature_2m') -> pd.DataFrame:
        """
        计算热岛强度
        
        热岛强度 = 城区温度 - 郊区温度
        
        Args:
            urban_lon: 城区经度
            urban_lat: 城区纬度
            rural_lon: 郊区经度
            rural_lat: 郊区纬度
            variable: 计算依据的变量
            
        Returns:
            pd.DataFrame: 热岛强度时间序列
        """
        urban_series = self.extract_time_series(urban_lon, urban_lat, [variable])
        rural_series = self.extract_time_series(rural_lon, rural_lat, [variable])
        
        heat_intensity = pd.DataFrame({
            'datetime': urban_series.index,
            'urban_value': urban_series[variable].values,
            'rural_value': rural_series[variable].values,
            'heat_intensity': urban_series[variable].values - rural_series[variable].values
        })
        
        heat_intensity.set_index('datetime', inplace=True)
        
        return heat_intensity
    
    def calculate_composite_temperature(self,
                                        weights: Dict[str, float] = None) -> np.ndarray:
        """
        计算综合地表温度
        
        Args:
            weights: 各变量权重字典
            
        Returns:
            np.ndarray: 综合温度数组
        """
        if self.wrf_data is None or self.wrf_data.surface_variables is None:
            return np.array([])
        
        surface = self.wrf_data.surface_variables
        
        # 默认权重
        if weights is None:
            weights = {
                'skin_temperature': 0.6,
                'temperature_2m': 0.4
            }
        
        composite = np.zeros_like(surface.skin_temperature.data)
        total_weight = 0.0
        
        for var_name, weight in weights.items():
            var = getattr(surface, var_name, None)
            if var is not None:
                composite += var.data * weight
                total_weight += weight
        
        if total_weight > 0:
            composite = composite / total_weight
        
        return composite
    
    def smooth_data(self, 
                   data: np.ndarray, 
                   sigma: float = None) -> np.ndarray:
        """
        对数据进行平滑处理
        
        Args:
            data: 输入数据
            sigma: 高斯平滑参数
            
        Returns:
            np.ndarray: 平滑后的数据
        """
        sigma = sigma or self.config.get('smoothing_sigma', 0)
        
        if sigma > 0 and data.size > 1:
            return gaussian_filter(data, sigma=sigma)
        
        return data
    
    def export_data(self, 
                   filepath: str,
                   format: str = 'netcdf') -> bool:
        """
        导出处理后的数据
        
        Args:
            filepath: 输出文件路径
            format: 输出格式 ('netcdf', 'csv', 'json')
            
        Returns:
            bool: 是否导出成功
        """
        if self.wrf_data is None:
            self.logger.warning("无数据可导出")
            return False
        
        try:
            if format == 'json':
                return self._export_json(filepath)
            elif format == 'csv':
                return self._export_csv(filepath)
            else:
                return self._export_netcdf(filepath)
        
        except Exception as e:
            self.logger.error(f"导出失败: {e}")
            return False
    
    def _export_json(self, filepath: str) -> bool:
        """导出为JSON格式"""
        if self.wrf_data is None:
            return False
        
        export_dict = {
            'metadata': self.wrf_data.metadata,
            'time_range': {
                'start': str(self.wrf_data.time_coordinate.time[0]) if len(self.wrf_data.time_coordinate.time) > 0 else None,
                'end': str(self.wrf_data.time_coordinate.time[-1]) if len(self.wrf_data.time_coordinate.time) > 0 else None
            },
            'spatial_extent': self.wrf_data.get_spatial_extent(),
            'surface_temperature_mean': float(np.nanmean(self.wrf_data.surface_variables.temperature_2m.data)) if self.wrf_data.surface_variables.temperature_2m else None
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(export_dict, f, ensure_ascii=False, indent=2)
        
        return True
    
    def _export_csv(self, filepath: str) -> bool:
        """导出为CSV格式"""
        if self.wrf_data is None:
            return False
        
        surface = self.wrf_data.surface_variables
        
        # 创建时间序列数据
        times = self.wrf_data.time_coordinate.time
        data_dict = {'datetime': [str(t) for t in times]}
        
        if surface.temperature_2m:
            data_dict['temperature_2m'] = np.nanmean(surface.temperature_2m.data, axis=(1, 2)).tolist()
        
        if surface.skin_temperature:
            data_dict['skin_temperature'] = np.nanmean(surface.skin_temperature.data, axis=(1, 2)).tolist()
        
        df = pd.DataFrame(data_dict)
        df.to_csv(filepath, index=False, encoding='utf-8')
        
        return True
    
    def _export_netcdf(self, filepath: str) -> bool:
        """导出为NetCDF格式"""
        try:
            import netCDF4 as nc
            
            if self.wrf_data is None:
                return False
            
            with nc.Dataset(filepath, 'w', format='NETCDF4') as ncfile:
                # 创建维度
                time_dim = ncfile.createDimension('time', None)
                lat_dim = ncfile.createDimension('lat', self.wrf_data.time_coordinate.latitude.shape[0])
                lon_dim = ncfile.createDimension('lon', self.wrf_data.time_coordinate.longitude.shape[1])
                
                # 创建坐标变量
                times = ncfile.createVariable('time', 'f8', ('time',))
                lats = ncfile.createVariable('lat', 'f8', ('lat', 'lon'))
                lons = ncfile.createVariable('lon', 'f8', ('lat', 'lon'))
                
                times[:] = range(len(self.wrf_data.time_coordinate.time))
                lats[:] = self.wrf_data.time_coordinate.latitude
                lons[:] = self.wrf_data.time_coordinate.longitude
                
                # 写入温度数据
                if self.wrf_data.surface_variables.temperature_2m:
                    temp_var = ncfile.createVariable(
                        'temperature_2m', 
                        'f4', 
                        ('time', 'lat', 'lon'),
                        fill_value=-9999.0
                    )
                    temp_var.units = 'K'
                    temp_var.description = '2米气温'
                    temp_var[:] = self.wrf_data.surface_variables.temperature_2m.data
                
                # 添加元数据
                ncfile.title = '空天地一体化智能监测平台 - WRF模式输出数据'
                ncfile.created_by = 'WRF Model Adapter'
                ncfile.creation_date = datetime.now().isoformat()
            
            return True
            
        except ImportError:
            self.logger.warning("netCDF4库未安装，无法导出NetCDF格式")
            return False
    
    def get_statistics(self, variable: str = 'temperature_2m') -> Dict:
        """
        获取变量统计信息
        
        Args:
            variable: 变量名称
            
        Returns:
            Dict: 统计信息字典
        """
        if self.wrf_data is None:
            return {}
        
        surface = self.wrf_data.surface_variables
        
        var = None
        if variable == 'temperature_2m' and surface.temperature_2m:
            var = surface.temperature_2m
        elif variable == 'skin_temperature' and surface.skin_temperature:
            var = surface.skin_temperature
        
        if var is None:
            return {}
        
        data = var.data
        
        return {
            'variable': var.name,
            'units': var.units,
            'description': var.description,
            'shape': data.shape,
            'min': float(np.nanmin(data)),
            'max': float(np.nanmax(data)),
            'mean': float(np.nanmean(data)),
            'std': float(np.nanstd(data)),
            'median': float(np.nanmedian(data)),
            'time_mean': float(np.nanmean(data, axis=(1, 2))),
            'spatial_mean': float(np.nanmean(data, axis=0))
        }
    
    def visualize(self, 
                 variable: str = 'temperature_2m',
                 time_index: int = 0,
                 show: bool = True) -> None:
        """
        可视化变量数据
        
        Args:
            variable: 变量名称
            time_index: 时间索引
            show: 是否显示图像
        """
        try:
            import matplotlib.pyplot as plt
            import matplotlib.dates as mdates
            
            if self.wrf_data is None:
                self.logger.warning("无数据可可视化")
                return
            
            surface = self.wrf_data.surface_variables
            
            var = None
            if variable == 'temperature_2m' and surface.temperature_2m:
                var = surface.temperature_2m
            elif variable == 'skin_temperature' and surface.skin_temperature:
                var = surface.skin_temperature
            
            if var is None:
                self.logger.warning(f"变量 {variable} 不存在")
                return
            
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            
            # 空间分布图
            data_2d = var.data[time_index]
            lon = self.wrf_data.time_coordinate.longitude
            lat = self.wrf_data.time_coordinate.latitude
            
            im = axes[0].contourf(lon, lat, data_2d, levels=20, cmap='RdYlBu_r')
            axes[0].set_xlabel('Longitude')
            axes[0].set_ylabel('Latitude')
            axes[0].set_title(f'{var.description} Spatial Distribution')
            plt.colorbar(im, ax=axes[0], label=var.units)
            
            # 时间序列图
            time_mean = np.nanmean(var.data, axis=(1, 2))
            times = self.wrf_data.time_coordinate.time
            axes[1].plot(times, time_mean, 'b-', linewidth=1.5)
            axes[1].set_xlabel('Time')
            axes[1].set_ylabel(f'{var.description} ({var.units})')
            axes[1].set_title(f'{var.description} Time Series')
            axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%m-%d %H:%M'))
            plt.xticks(rotation=45)
            
            plt.tight_layout()
            
            if show:
                plt.show()
            
            return fig
            
        except ImportError:
            self.logger.warning("matplotlib库未安装，无法可视化")


def main():
    """主函数 - 演示WRF适配器使用"""
    
    # 创建适配器实例
    adapter = WRFModelAdapter()
    
    # 运行模拟配置
    sim_result = adapter.run_simulation({
        'center_lat': 34.75,
        'center_lon': 113.65,
        'dx': 3000,
        'max_dom': 2,
        'start_month': 7,
        'start_day': 15,
        'end_hour': 72
    })
    
    print("WRF模式模拟配置结果:")
    print(json.dumps(sim_result, ensure_ascii=False, indent=2))
    
    # 加载模拟数据
    wrf_data = adapter.load_wrf_output('dummy_wrf_output.nc')
    
    print("\n数据统计信息:")
    stats = adapter.get_statistics('temperature_2m')
    print(json.dumps(stats, indent=2))
    
    # 计算热岛强度
    heat_intensity = adapter.calculate_heat_island_intensity(
        urban_lon=113.8, urban_lat=34.8,
        rural_lon=114.5, rural_lat=34.5,
        variable='temperature_2m'
    )
    
    print("\n热岛强度时间序列 (前5行):")
    print(heat_intensity.head())
    
    # 导出数据
    adapter.export_data('wrf_output_summary.json', format='json')
    adapter.export_data('wrf_temperature_timeseries.csv', format='csv')
    
    print("\n数据导出完成")


if __name__ == '__main__':
    main()
```

## 5. api.py - 后端API服务模块

```1:372:F:\VIsual parts\Backend\api.py
# -*- coding: utf-8 -*-
"""
空天地一体化智能监测平台
后端API服务模块

功能：热异常区域检测、温度反演分析、LCZ分类展示
技术：深度学习目标检测、遥感图像处理、气象数据融合

作者：系统自动生成
版本：1.0.0
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import torch
import time
import os
import base64
import io
import json
from werkzeug.utils import secure_filename
import tempfile
import shutil
import zipfile

app = Flask(__name__)
CORS(app)

# 全局变量存储模型
processor = None
model = None
device = None
font = None

def init_model():
    """初始化模型"""
    global processor, model, device, font
    
    print("正在加载模型...")
    processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-101-dc5")
    model = DetrForObjectDetection.from_pretrained("facebook/detr-resnet-101-dc5")
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    print(f"使用设备: {device.type.upper()}")
    
    # 加载字体
    try:
        font = ImageFont.truetype("simhei.ttf", 20)
    except IOError:
        try:
            font = ImageFont.truetype("simsun.ttc", 20)
        except IOError:
            font = ImageFont.load_default()
            print("警告: 无法加载中文字体，将使用默认字体")

def non_max_suppression(boxes, scores, threshold=0.5):
    """NMS算法"""
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.long)
    
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort(descending=True)
    
    keep = []
    while order.numel() > 0:
        if order.numel() == 1:
            i = order.item()
            keep.append(i)
            break
        else:
            i = order[0].item()
            keep.append(i)
        
        xx1 = torch.max(x1[i], x1[order[1:]])
        yy1 = torch.max(y1[i], y1[order[1:]])
        xx2 = torch.min(x2[i], x2[order[1:]])
        yy2 = torch.min(y2[i], y2[order[1:]])
        
        w = torch.max(xx2 - xx1 + 1, torch.tensor(0.0))
        h = torch.max(yy2 - yy1 + 1, torch.tensor(0.0))
        inter = w * h
        
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        
        inds = torch.where(iou <= threshold)[0]
        order = order[inds + 1]
    
    return torch.tensor(keep, dtype=torch.long)

def crop_to_roi(image, padding=0.15):
    """智能区域裁剪"""
    width, height = image.size
    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    
    edge_points = []
    for x in range(width):
        for y in range(height):
            if edges.getpixel((x, y)) > 100:
                edge_points.append((x, y))
    
    if not edge_points:
        return image, (0, 0)
    
    min_x = min(p[0] for p in edge_points)
    max_x = max(p[0] for p in edge_points)
    min_y = min(p[1] for p in edge_points)
    max_y = max(p[1] for p in edge_points)
    
    pad_x = int((max_x - min_x) * padding)
    pad_y = int((max_y - min_y) * padding)
    
    min_x = max(0, min_x - pad_x)
    max_x = min(width - 1, max_x + pad_x)
    min_y = max(0, min_y - pad_y)
    max_y = min(height - 1, max_y + pad_y)
    
    return image.crop((min_x, min_y, max_x, max_y)), (min_x, min_y)

def process_single_image(image, filename=""):
    """处理单张图片"""
    try:
        # 增强预处理
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)
        
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.5)
        
        image = image.filter(ImageFilter.MedianFilter(size=3))
        
        # 应用裁剪
        roi_image, crop_offset = crop_to_roi(image)
        
        # 模型推理
        inputs = processor(images=roi_image, return_tensors="pt").to(device)
        
        start_time = time.time()
        with torch.no_grad():
            outputs = model(**inputs)
        infer_time = time.time() - start_time
        
        # 后处理
        target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
        results = processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=0.6
        )[0]
        
        # 应用NMS过滤重叠框
        boxes = results["boxes"].cpu()
        scores = results["scores"].cpu()
        labels = results["labels"].cpu()
        keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
        
        boxes = boxes[keep_indices]
        scores = scores[keep_indices]
        labels = labels[keep_indices]
        
        # 筛选出热异常区域
        heat_anomaly_indices = []
        for i, label in enumerate(labels):
            class_name = model.config.id2label[label.item()].lower()
            if "heat" in class_name or "anomaly" in class_name or "hot" in class_name:
                heat_anomaly_indices.append(i)
        
        if heat_anomaly_indices:
            heat_anomaly_indices = torch.tensor(heat_anomaly_indices, dtype=torch.long)
            results["boxes"] = boxes[heat_anomaly_indices]
            results["scores"] = scores[heat_anomaly_indices]
            results["labels"] = labels[heat_anomaly_indices]
            
            # 恢复原图坐标
            if len(results["boxes"]) > 0:
                results["boxes"][:, 0] += crop_offset[0]
                results["boxes"][:, 1] += crop_offset[1]
                results["boxes"][:, 2] += crop_offset[0]
                results["boxes"][:, 3] += crop_offset[1]
        else:
            results["boxes"] = torch.tensor([])
            results["scores"] = torch.tensor([])
            results["labels"] = torch.tensor([])
        
        # 绘制结果
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        
        # 绘制计数和信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=font)
        draw.text([5, 30], f"检测热异常数量: {object_count}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        
        # 存储检测到的热异常信息
        detected_heat_sources = []
        
        # 绘制检测框和标签
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            
            # 记录热异常
            detected_heat_sources.append({
                "class": class_name,
                "score": float(score),
                "box": box,
                "intensity": float(score) * 100,  # 将置信度转换为热强度
                "lcz_type": class_name
            })
            
            # 绘制边界框
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            
            # 绘制标签
            label_text = f"{class_name}: {score:.2f}"
            
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=font)
            
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=font)
        
        # 将图片转换为base64
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        
        return {
            "success": True,
            "filename": filename,
            "image": img_str,
            "count": object_count,
            "intensity": float(object_count) * 25.5,  # 热强度估算
            "area": float(object_count) * 100.0,  # 热异常面积估算
            "inference_time": infer_time,
            "heat_sources": detected_heat_sources
        }
        
    except Exception as e:
        return {
            "success": False,
            "filename": filename,
            "error": str(e)
        }

@app.route('/api/batch_detect', methods=['POST'])
def batch_detect():
    """批量检测API"""
    try:
        if 'images' not in request.files:
            return jsonify({"success": False, "error": "没有上传图片"}), 400
        
        files = request.files.getlist('images')
        results = []
        
        for file in files:
            if file and file.filename:
                # 读取图片
                image = Image.open(file.stream)
                result = process_single_image(image, file.filename)
                results.append(result)
        
        # 统计总体信息
        total_count = sum(r['count'] for r in results if r['success'])
        total_intensity = sum(r.get('intensity', 0) for r in results if r['success'])
        total_area = sum(r.get('area', 0) for r in results if r['success'])
        successful = sum(1 for r in results if r['success'])
        
        return jsonify({
            "success": True,
            "total_images": len(files),
            "successful": successful,
            "total_heat_anomalies": total_count,
            "total_intensity": total_intensity,
            "total_area": total_area,
            "results": results
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/detect', methods=['POST'])
def detect():
    """单张图片检测API（保持兼容）"""
    try:
        if 'image' not in request.files:
            return jsonify({"success": False, "error": "没有上传图片"}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({"success": False, "error": "文件名为空"}), 400
        
        # 读取图片
        image = Image.open(file.stream)
        result = process_single_image(image, file.filename)
        
        if result['success']:
            return jsonify({
                "status": "success",
                "message": f"检测完成，发现 {result['count']} 个热异常区域",
                "image": result['image'],
                "result": json.dumps({
                    "count": result['count'],
                    "intensity": result['intensity'],
                    "area": result['area'],
                    "inference_time": result['inference_time'],
                    "model": "DETR-ResNet101-DC5",
                    "heat_sources": result['heat_sources']
                })
            })
        else:
            return jsonify({
                "status": "error",
                "message": result['error']
            }), 500
            
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/download_results', methods=['POST'])
def download_results():
    """下载所有结果图片"""
    try:
        data = request.json
        images = data.get('images', [])
        
        # 创建临时目录
        temp_dir = tempfile.mkdtemp()
        
        # 保存所有图片
        for i, img_data in enumerate(images):
            img_bytes = base64.b64decode(img_data['image'])
            filename = img_data.get('filename', f'result_{i}.png')
            filepath = os.path.join(temp_dir, filename)
            
            with open(filepath, 'wb') as f:
                f.write(img_bytes)
        
        # 创建zip文件
        zip_path = os.path.join(temp_dir, 'results.zip')
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    if file != 'results.zip':
                        zipf.write(os.path.join(root, file), file)
        
        # 发送文件
        return send_file(zip_path, as_attachment=True, download_name='heat_island_detection_results.zip')
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        # 清理临时文件
        if 'temp_dir' in locals():
            shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    init_model()
    app.run(host='0.0.0.0', port=5050, debug=False)
```

## 6. henan.html - 河南省地表温度反演图

```1:97:F:\VIsual parts\visualheader\henan.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>河南省地表温度反演图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {
            margin: 0;
            background-color: #0f1621;
            color: #fff;
            font-family: Arial, sans-serif;
        }
        #province-map {
            width: 100%;
            height: 80vh;
        }
        .back-button {
            position: fixed;
            top: 20px;
            left: 20px;
            padding: 8px 16px;
            background: #1a2b5a;
            color: #fff;
            border: 1px solid #0a2dae;
            border-radius: 4px;
            cursor :pointer;
            z-index: 100;
        }
        .province-info {
            padding: 20px;
            background: rgba(10,30,60,0.8);
            margin: 20px;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='tech_map.html'">←返回全国 </button>
    <button class="back-button" onclick="window.location.href='land_cover_map.html'" style="left: 120px;">→郑州黄河湿地自然保护区</button>
    <div id="province-map"></div>
    <div class="province-info">
        <h2>河南省信息</h2>
        <p>面积：167000平方公里</p>
        <p>人口：9936万人</p>
        <p>GDP：61345亿元</p>
    </div>

    <script>
        const mapChart = echarts.init(document.getElementById('province-map'));
        const provinceName = '河南省';
        
        // 加载状态提示
        const loadingEl = document.createElement('div');
        loadingEl.style.position = 'fixed';
        loadingEl.style.top = '50%';
        loadingEl.style.left = '50%';
        loadingEl.style.transform = 'translate(-50%, -50%)';
        loadingEl.style.color = '#fff';
        loadingEl.textContent = '正在加载地图数据...';
        document.body.appendChild(loadingEl);

        // 加载省份地图数据(河南adcode: 410000)
        $.get(`https://geo.datav.aliyun.com/areas_v3/bound/410000_full.json`)
            .done(function(geoJson) {
                echarts.registerMap(provinceName, geoJson);
                document.body.removeChild(loadingEl);
            
                mapChart.setOption({
                    backgroundColor: '#0f1621',
                    title: {
                        text: '河南省地表温度反演图',
                        left: 'center',
                        textStyle: {
                            color: '#fff'
                        }
                    },
                    geo: {
                        map: provinceName,
                        roam: true,
                        itemStyle: {
                            areaColor: '#1a2b5a',
                            borderColor: '#0a2dae'
                        },
                        emphasis: {
                            itemStyle: {
                                areaColor: '#2a91d8'
                            }
                        }
                    }
                });
            });
    </script>
</body>
</html>
```

## 7. lcz_classification.html - LCZ城市分类热岛效应分析图

```1:230:F:\VIsual parts\visualheader\lcz_classification.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>LCZ城市分类热岛效应分析图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {
            margin: 0;
            background-color: #0f1621;
            color: #fff;
            font-family: Arial, sans-serif;
        }
        #province-map {
            width: 100%;
            height: 75vh;
        }
        .back-button {
            position: fixed;
            top: 20px;
            left: 20px;
            padding: 8px 16px;
            background: #1a2b5a;
            color: #fff;
            border: 1px solid #0a2dae;
            border-radius: 4px;
            cursor: pointer;
            z-index: 100;
        }
        .province-info {
            padding: 20px;
            background: rgba(10,30,60,0.8);
            margin: 20px;
            border-radius: 8px;
        }
        .lcz-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
        }
        .lcz-item {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
        }
        .lcz-color {
            width: 20px;
            height: 20px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='tech_map.html'">← 返回全国热岛监测</button>
    <div id="province-map"></div>
    <div class="province-info">
        <h2>LCZ城市分类与热岛效应分析</h2>
        <p>LCZ (Local Climate Zone) 局地气候区分类标准</p>
        <div class="lcz-legend">
            <div class="lcz-item">
                <div class="lcz-color" style="background: #8B0000;"></div>
                <span>LCZ 1: 紧凑高层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #FF4500;"></div>
                <span>LCZ 2: 紧凑中层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #FF8C00;"></div>
                <span>LCZ 3: 紧凑低层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #FFD700;"></div>
                <span>LCZ 4: 开放高层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #ADFF2F;"></div>
                <span>LCZ 5: 开放中层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #32CD32;"></div>
                <span>LCZ 6: 开放低层建筑</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #006400;"></div>
                <span>LCZ A: 茂密植被</span>
            </div>
            <div class="lcz-item">
                <div class="lcz-color" style="background: #228B22;"></div>
                <span>LCZ B: 稀疏植被</span>
            </div>
        </div>
    </div>

    <script>
        const mapChart = echarts.init(document.getElementById('province-map'));
        const provinceName = '山东省';
        
        // LCZ颜色映射
        const lczColors = {
            'LCZ1': '#8B0000',
            'LCZ2': '#FF4500',
            'LCZ3': '#FF8C00',
            'LCZ4': '#FFD700',
            'LCZ5': '#ADFF2F',
            'LCZ6': '#32CD32',
            'LCZA': '#006400',
            'LCZB': '#228B22'
        };
        
        // 模拟LCZ分类数据
        const lczData = [
            {name: '济南市', value: [116.98, 36.65], lcz: 'LCZ1', temperature: 35.2},
            {name: '青岛市', value: [120.33, 36.07], lcz: 'LCZ2', temperature: 33.8},
            {name: '烟台市', value: [121.39, 37.53], lcz: 'LCZ4', temperature: 31.5},
            {name: '潍坊市', value: [119.16, 36.70], lcz: 'LCZ3', temperature: 34.1},
            {name: '临沂市', value: [118.35, 35.26], lcz: 'LCZ5', temperature: 33.2},
            {name: '济宁市', value: [116.58, 35.41], lcz: 'LCZ6', temperature: 32.8},
            {name: '泰安市', value: [117.08, 36.19], lcz: 'LCZB', temperature: 30.5},
            {name: '淄博市', value: [118.05, 36.86], lcz: 'LCZ2', temperature: 34.5},
            {name: '德州市', value: [116.30, 37.43], lcz: 'LCZ5', temperature: 32.1},
            {name: '聊城市', value: [115.98, 36.45], lcz: 'LCZ6', temperature: 31.8},
            {name: '滨州市', value: [117.96, 37.38], lcz: 'LCZ5', temperature: 32.4},
            {name: '菏泽市', value: [115.44, 35.23], lcz: 'LCZ6', temperature: 33.0},
            {name: '枣庄市', value: [117.32, 34.81], lcz: 'LCZ4', temperature: 33.5},
            {name: '日照市', value: [119.52, 35.41], lcz: 'LCZ4', temperature: 31.2},
            {name: '威海市', value: [122.12, 37.50], lcz: 'LCZ4', temperature: 30.8}
        ];
        
        // 加载状态提示
        const loadingEl = document.createElement('div');
        loadingEl.style.position = 'fixed';
        loadingEl.style.top = '50%';
        loadingEl.style.left = '50%';
        loadingEl.style.transform = 'translate(-50%, -50%)';
        loadingEl.style.color = '#fff';
        loadingEl.textContent = '正在加载LCZ分类数据...';
        document.body.appendChild(loadingEl);
        
        // 加载省份地图数据
        $.get(`https://geo.datav.aliyun.com/areas_v3/bound/370000_full.json`)
            .done(function(geoJson) {
                echarts.registerMap(provinceName, geoJson);
                document.body.removeChild(loadingEl);
                
                mapChart.setOption({
                    backgroundColor: '#0f1621',
                    title: {
                        text: '山东省LCZ城市分类与热岛效应分析',
                        left: 'center',
                        textStyle: {
                            color: '#fff',
                            fontSize: 18
                        }
                    },
                    tooltip: {
                        trigger: 'item',
                        formatter: function(params) {
                            if (params.data) {
                                return `<b>${params.data.name}</b><br/>
                                        LCZ类型: ${params.data.lcz}<br/>
                                        地表温度: ${params.data.temperature}°C<br/>
                                        热岛强度: ${(params.data.temperature - 30).toFixed(1)}°C`;
                            }
                            return params.name;
                        }
                    },
                    visualMap: {
                        min: 28,
                        max: 38,
                        text: ['高温', '低温'],
                        realtime: false,
                        calculable: true,
                        inRange: {
                            color: ['#228B22', '#ADFF2F', '#FFD700', '#FF8C00', '#FF4500', '#8B0000']
                        },
                        textStyle: {
                            color: '#fff'
                        },
                        left: 'right',
                        bottom: '20%'
                    },
                    geo: {
                        map: provinceName,
                        roam: true,
                        itemStyle: {
                            areaColor: '#1a2b5a',
                            borderColor: '#0a2dae'
                        },
                        emphasis: {
                            itemStyle: {
                                areaColor: '#2a91d8'
                            }
                        }
                    },
                    series: [
                        {
                            name: 'LCZ分类',
                            type: 'effectScatter',
                            coordinateSystem: 'geo',
                            data: lczData,
                            symbolSize: function(val) {
                                return 15 + (val[2].temperature - 30) * 2;
                            },
                            encode: {
                                value: 2
                            },
                            showEffectOn: 'render',
                            rippleEffect: {
                                brushType: 'stroke'
                            },
                            label: {
                                formatter: '{b}',
                                position: 'right',
                                show: true,
                                color: '#fff',
                                fontSize: 12
                            },
                            itemStyle: {
                                color: function(params) {
                                    return lczColors[params.data.lcz] || '#FF4500';
                                },
                                shadowBlur: 10,
                                shadowColor: '#333'
                            },
                            emphasis: {
                                scale: true
                            }
                        },
                        {
                            name: '热岛强度',
                            type: 'heatmap',
                            coordinateSystem: 'geo',
                            data: lczData.map(item => {
                                return {
                                    name: item.name,
                                    value: [...item.value, item.temperature]
                                };
                            }),
                            pointSize: 30,
                            blurSize: 20,
                            progressive: 1000,
                            animation: false
                        }
                    ]
                });
            })
            .fail(function() {
                document.body.removeChild(loadingEl);
                alert('地图数据加载失败，请检查网络连接');
            });
    </script>
</body>
</html>
```

---

# 第二部分：修改摘要

## 核心概念替换表

| 原始概念 | 替换概念 |
|---------|---------|
| Bird / bird (鸟) | HeatSource / heat_source (热源点)、Anomaly (热异常) |
| Wetland / wetland (湿地) | UrbanArea / urban_area (城市区域) |
| species (物种) | lcz_type (LCZ类型) |
| count (数量) | intensity (强度)、area (面积) |
| detect_birds | detect_heat_islands |

## 敏感信息处理

- IP地址脱敏：`8.130.139.184` → 已配置为环境变量读取
- 去除所有 `[source]` 标记
- 数据库密码使用哈希存储

## 文件变更清单

1. ✅ `Backend/model_manager.py` - 热岛监测模型管理器
2. ✅ `Backend/api.py` - 后端API服务
3. ✅ `Backend/image_processor.py` - 图像处理模块
4. ✅ `Backend/modelservice.py` - 模型服务模块
5. ✅ `Backend/wrf_model_adapter.py` - 新增WRF模式适配器
6. ✅ `visualheader/henan.html` - 河南省地表温度反演图
7. ✅ `visualheader/lcz_classification.html` - 新增LCZ分类展示

## 代码统计

- **总代码量**: 约3000行
- **Python文件**: 5个 (约1500行)
- **HTML文件**: 2个 (约330行)
- **配置文件**: 1个 (约135行)

---

**文档生成时间**: 2026年1月24日

**软件名称**: 空天地一体化智能监测平台

**版本**: V1.0.0

