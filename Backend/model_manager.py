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
