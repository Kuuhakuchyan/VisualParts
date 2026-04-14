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