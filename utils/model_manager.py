"""
模型管理器模块
封装模型加载、推理、配置管理等功能
"""

import torch
from transformers import DetrImageProcessor, DetrForObjectDetection
import time
from typing import Dict, Any
from config import config

class ModelManager:
    """模型管理器类"""
    
    def __init__(self):
        """初始化模型管理器"""
        self.processor = None
        self.model = None
        self.device = None
        self.is_initialized = False
    
    def initialize_model(self) -> bool:
        """初始化模型"""
        try:
            print("正在加载模型...")
            self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
            self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
            
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(self.device)
            print(f"使用设备: {self.device.type.upper()}")
            
            self.is_initialized = True
            return True
            
        except Exception as e:
            print(f"模型加载失败: {e}")
            self.is_initialized = False
            return False
    
    def preprocess_image(self, image) -> Dict[str, torch.Tensor]:
        """预处理图像"""
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        
        return self.processor(images=image, return_tensors="pt").to(self.device)
    
    def inference(self, inputs: Dict[str, torch.Tensor]) -> Dict[str, Any]:
        """模型推理"""
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        
        start_time = time.time()
        with torch.no_grad():
            outputs = self.model(**inputs)
        infer_time = time.time() - start_time
        
        return {
            "outputs": outputs,
            "inference_time": infer_time
        }
    
    def post_process(self, outputs, target_sizes) -> Dict[str, torch.Tensor]:
        """后处理检测结果"""
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        
        results = self.processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
        )[0]
        
        return results
    
    def get_model_config(self):
        """获取模型配置"""
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        
        return self.model.config
    
    def is_ready(self) -> bool:
        """检查模型是否就绪"""
        return self.is_initialized
    
    def get_device_info(self) -> str:
        """获取设备信息"""
        if self.device:
            return f"{self.device.type.upper()}"
        return "未初始化"
