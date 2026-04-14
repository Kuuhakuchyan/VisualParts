"""
日志系统模块
提供统一的日志记录功能
"""

import logging
import os
from datetime import datetime
from typing import Optional

def setup_logger(
    name: str = "visual_parts",
    level: int = logging.INFO,
    log_file: Optional[str] = None,
    format_string: Optional[str] = None
) -> logging.Logger:
    """
    设置并返回配置好的日志记录器
    
    Args:
        name: 日志记录器名称
        level: 日志级别
        log_file: 日志文件路径，如果为None则只输出到控制台
        format_string: 日志格式字符串
    
    Returns:
        logging.Logger: 配置好的日志记录器
    """
    if format_string is None:
        format_string = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    # 创建日志记录器
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # 避免重复添加处理器
    if logger.handlers:
        return logger
    
    # 创建格式化器
    formatter = logging.Formatter(format_string)
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # 文件处理器（如果指定了日志文件）
    if log_file:
        # 确保日志目录存在
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir, exist_ok=True)
        
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger

def get_api_logger() -> logging.Logger:
    """获取API模块专用的日志记录器"""
    return setup_logger(
        name="visual_parts.api",
        log_file="logs/api.log"
    )

def get_auth_logger() -> logging.Logger:
    """获取认证模块专用的日志记录器"""
    return setup_logger(
        name="visual_parts.auth",
        log_file="logs/auth.log"
    )

def get_detection_logger() -> logging.Logger:
    """获取检测模块专用的日志记录器"""
    return setup_logger(
        name="visual_parts.detection",
        log_file="logs/detection.log"
    )

def log_api_request(logger: logging.Logger, endpoint: str, method: str, 
                   status_code: int, processing_time: float, user_agent: str = None):
    """记录API请求日志"""
    logger.info(
        f"API Request - {method} {endpoint} - Status: {status_code} - "
        f"Time: {processing_time:.3f}s - UserAgent: {user_agent or 'Unknown'}"
    )

def log_detection_result(logger: logging.Logger, filename: str, count: int, 
                        inference_time: float, success: bool = True):
    """记录检测结果日志"""
    status = "成功" if success else "失败"
    logger.info(
        f"Detection Result - 文件: {filename} - 检测数量: {count} - "
        f"推理时间: {inference_time:.3f}s - 状态: {status}"
    )

def log_error(logger: logging.Logger, error_type: str, error_message: str, 
             stack_trace: str = None):
    """记录错误日志"""
    logger.error(
        f"Error - 类型: {error_type} - 消息: {error_message}"
    )
    if stack_trace:
        logger.debug(f"Stack Trace: {stack_trace}")

# 默认日志记录器
default_logger = setup_logger()
