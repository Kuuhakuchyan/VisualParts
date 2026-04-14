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
