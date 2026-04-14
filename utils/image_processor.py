"""
图像处理器模块
封装图像预处理、增强、裁剪等功能
"""

import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import time
import base64
import io
from typing import Dict, List, Tuple, Optional
from config import config

class ImageProcessor:
    """图像处理器类"""
    
    def __init__(self):
        self.config = config.model
        self.font = self._load_font()
    
    def _load_font(self) -> ImageFont.FreeTypeFont:
        """加载字体"""
        try:
            return ImageFont.truetype("simhei.ttf", 20)
        except IOError:
            try:
                return ImageFont.truetype("simsun.ttc", 20)
            except IOError:
                font = ImageFont.load_default()
                print("警告: 无法加载中文字体，将使用默认字体")
                return font
    
    def non_max_suppression(self, boxes: torch.Tensor, scores: torch.Tensor, threshold: float = 0.5) -> torch.Tensor:
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
    
    def crop_to_roi(self, image: Image.Image, padding: float = None) -> Tuple[Image.Image, Tuple[int, int]]:
        """智能区域裁剪"""
        if padding is None:
            padding = self.config.padding_ratio
            
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
    
    def enhance_image(self, image: Image.Image) -> Image.Image:
        """图像增强"""
        # 对比度增强
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(self.config.contrast_enhance)
        
        # 锐化增强
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(self.config.sharpness_enhance)
        
        # 中值滤波
        image = image.filter(ImageFilter.MedianFilter(size=3))
        
        return image
    
    def draw_detection_results(self, image: Image.Image, results: Dict, crop_offset: Tuple[int, int], 
                             infer_time: float) -> Tuple[Image.Image, List[Dict]]:
        """绘制检测结果"""
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        
        # 绘制计数和信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=self.font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        
        # 存储检测到的对象信息
        detected_objects = []
        
        # 绘制检测框和标签
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = results["class_names"][i]
            color = colors[i % len(colors)]
            
            # 记录检测对象
            detected_objects.append({
                "class": class_name,
                "score": float(score),
                "box": box
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
        
        return image, detected_objects
    
    def image_to_base64(self, image: Image.Image) -> str:
        """将图片转换为base64字符串"""
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()
