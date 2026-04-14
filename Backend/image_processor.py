"""
图像处理模块
封装所有图像处理相关的功能
"""

import torch
import time
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import io
import base64
from typing import Dict, List, Tuple, Optional

from config import config

class ImageProcessor:
    """图像处理器类"""
    
    def __init__(self, model, processor, device, font):
        self.model = model
        self.processor = processor
        self.device = device
        self.font = font
        self.colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
    
    @staticmethod
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
    
    @staticmethod
    def crop_to_roi(image: Image.Image, padding: float = 0.15) -> Tuple[Image.Image, Tuple[int, int]]:
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
    
    def enhance_image(self, image: Image.Image) -> Image.Image:
        """图像增强预处理"""
        # 对比度增强
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.model.contrast_enhance)
        
        # 锐化增强
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.model.sharpness_enhance)
        
        # 中值滤波
        image = image.filter(ImageFilter.MedianFilter(size=3))
        
        return image
    
    def detect_heat_islands(self, image: Image.Image) -> Dict:
        """检测图片中的热异常区域"""
        try:
            # 图像增强
            enhanced_image = self.enhance_image(image)

            # 应用裁剪
            roi_image, crop_offset = self.crop_to_roi(enhanced_image, config.model.padding_ratio)

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
            raise Exception(f"热异常检测失败: {str(e)}")
    
    def draw_detection_results(self, detection_result: Dict) -> Image.Image:
        """绘制检测结果"""
        image = detection_result["original_image"]
        results = detection_result["results"]
        infer_time = detection_result["inference_time"]
        
        draw = ImageDraw.Draw(image)
        object_count = len(results["boxes"])
        
        # 绘制计数和信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=self.font)
        draw.text([5, 30], f"检测热异常区域数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        
        # 绘制检测框和标签
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = self.model.config.id2label[label.item()]
            color = self.colors[i % len(self.colors)]
            
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
        
        return image, detected_objects, object_count
    
    def image_to_base64(self, image: Image.Image) -> str:
        """将图片转换为base64字符串"""
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()
    
    def process_single_image(self, image: Image.Image, filename: str = "") -> Dict:
        """处理单张图片"""
        try:
            # 检测热异常区域
            detection_result = self.detect_heat_islands(image)
            
            # 绘制结果
            result_image, detected_objects, object_count = self.draw_detection_results(detection_result)
            
            # 转换为base64
            img_str = self.image_to_base64(result_image)
            
            return {
                "success": True,
                "filename": filename,
                "image": img_str,
                "count": object_count,
                "inference_time": detection_result["inference_time"],
                "objects": detected_objects
            }
            
        except Exception as e:
            return {
                "success": False,
                "filename": filename,
                "error": str(e)
            }
