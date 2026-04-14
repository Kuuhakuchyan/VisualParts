# 文件名: Backend/api.py
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
processor = None
model = None
device = None
font = None

def init_model():
    global processor, model, device, font
    print("正在加载模型...")
    processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-101-dc5")
    model = DetrForObjectDetection.from_pretrained("facebook/detr-resnet-101-dc5")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    print(f"使用设备: {device.type.upper()}")
    try:
        font = ImageFont.truetype("simhei.ttf", 20)
    except IOError:
        try:
            font = ImageFont.truetype("simsun.ttc", 20)
        except IOError:
            font = ImageFont.load_default()
            print("警告: 无法加载中文字体，将使用默认字体")

def non_max_suppression(boxes, scores, threshold=0.5):
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
    try:
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.5)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        roi_image, crop_offset = crop_to_roi(image)
        inputs = processor(images=roi_image, return_tensors="pt").to(device)
        start_time = time.time()
        with torch.no_grad():
            outputs = model(**inputs)
        infer_time = time.time() - start_time
        target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
        results = processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=0.6
        )[0]
        boxes = results["boxes"].cpu()
        scores = results["scores"].cpu()
        labels = results["labels"].cpu()
        keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
        boxes = boxes[keep_indices]
        scores = scores[keep_indices]
        labels = labels[keep_indices]
        bird_indices = []
        for i, label in enumerate(labels):
            class_name = model.config.id2label[label.item()].lower()
            if "bird" in class_name:
                bird_indices.append(i)
        if bird_indices:
            bird_indices = torch.tensor(bird_indices, dtype=torch.long)
            results["boxes"] = boxes[bird_indices]
            results["scores"] = scores[bird_indices]
            results["labels"] = labels[bird_indices]
            if len(results["boxes"]) > 0:
                results["boxes"][:, 0] += crop_offset[0]
                results["boxes"][:, 1] += crop_offset[1]
                results["boxes"][:, 2] += crop_offset[0]
                results["boxes"][:, 3] += crop_offset[1]
        else:
            results["boxes"] = torch.tensor([])
            results["scores"] = torch.tensor([])
            results["labels"] = torch.tensor([])
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            detected_objects.append({"class": class_name, "score": float(score), "box": box})
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=font)
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=font)
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        return {"success": True, "filename": filename, "image": img_str, "count": object_count, "inference_time": infer_time, "objects": detected_objects}
    except Exception as e:
        return {"success": False, "filename": filename, "error": str(e)}

@app.route('/api/batch_detect', methods=['POST'])
def batch_detect():
    try:
        if 'images' not in request.files:
            return jsonify({"success": False, "error": "没有上传图片"}), 400
        files = request.files.getlist('images')
        results = []
        for file in files:
            if file and file.filename:
                image = Image.open(file.stream)
                result = process_single_image(image, file.filename)
                results.append(result)
        total_count = sum(r['count'] for r in results if r['success'])
        successful = sum(1 for r in results if r['success'])
        return jsonify({"success": True, "total_images": len(files), "successful": successful, "total_birds": total_count, "results": results})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/detect', methods=['POST'])
def detect():
    try:
        if 'image' not in request.files:
            return jsonify({"success": False, "error": "没有上传图片"}), 400
        file = request.files['image']
        if file.filename == '':
            return jsonify({"success": False, "error": "文件名为空"}), 400
        image = Image.open(file.stream)
        result = process_single_image(image, file.filename)
        if result['success']:
            return jsonify({"status": "success", "message": f"检测完成，发现 {result['count']} 只鸟类", "image": result['image'], "result": json.dumps({"count": result['count'], "inference_time": result['inference_time'], "model": "DETR-ResNet101-DC5", "objects": result['objects']})})
        else:
            return jsonify({"status": "error", "message": result['error']}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/download_results', methods=['POST'])
def download_results():
    try:
        data = request.json
        images = data.get('images', [])
        temp_dir = tempfile.mkdtemp()
        for i, img_data in enumerate(images):
            img_bytes = base64.b64decode(img_data['image'])
            filename = img_data.get('filename', f'result_{i}.png')
            filepath = os.path.join(temp_dir, filename)
            with open(filepath, 'wb') as f:
                f.write(img_bytes)
        zip_path = os.path.join(temp_dir, 'results.zip')
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    if file != 'results.zip':
                        zipf.write(os.path.join(root, file), file)
        return send_file(zip_path, as_attachment=True, download_name='bird_detection_results.zip')
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if 'temp_dir' in locals():
            shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    init_model()
    app.run(host='0.0.0.0', port=5050, debug=False)

# 文件名: Backend/auth_api.py
from flask import Flask, request, jsonify
from database import Database
import json

app = Flask(__name__)
db = Database()

SECURITY_QUESTIONS = [
    "你的生日是什么时候？", "你母亲的名字是什么？", "你的第一所学校的名称是什么？",
    "你的宠物的名字是什么？", "你最喜欢的电影是什么？"
]

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    question = data.get('question')
    answer = data.get('answer')
    if not all([username, password, question, answer]):
        return jsonify({'success': False, 'message': '缺少必要参数'}), 400
    if question not in SECURITY_QUESTIONS:
        return jsonify({'success': False, 'message': '无效的安全问题'}), 400
    if db.register_user(username, password, question, answer):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'message': '用户名已存在'}), 400

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not all([username, password]):
        return jsonify({'success': False, 'message': '缺少用户名或密码'}), 400
    if db.verify_user(username, password):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'message': '用户名或密码错误'}), 401

@app.route('/')
def index():
    return jsonify({'status': 'running', 'service': 'auth_api'})

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'})

@app.route('/api/security-questions', methods=['GET'])
def get_security_questions():
    return jsonify({'questions': SECURITY_QUESTIONS})

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    username = data.get('username')
    if not username:
        return jsonify({'success': False, 'message': '请输入用户名'}), 400
    question = db.get_security_question(username)
    if not question:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    return jsonify({'success': True, 'question': question})

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    username = data.get('username')
    answer = data.get('answer')
    new_password = data.get('newPassword')
    if not all([username, answer, new_password]):
        return jsonify({'success': False, 'message': '缺少必要参数'}), 400
    if not db.verify_security_answer(username, answer):
        return jsonify({'success': False, 'message': '安全问题答案错误'}), 401
    if db.reset_password(username, new_password):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'message': '密码重置失败'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

# 文件名: Backend/database.py
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

def init_db():
    conn = sqlite3.connect('visual_parts.db')
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, security_question TEXT NOT NULL,
        security_answer TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS geo_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        data_type TEXT NOT NULL, coordinates TEXT NOT NULL, properties TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users (id)
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
        self.cursor.execute('SELECT password_hash FROM users WHERE username = ?', (username,))
        result = self.cursor.fetchone()
        if result and check_password_hash(result[0], password):
            return True
        return False
    
    def get_security_question(self, username):
        self.cursor.execute('SELECT security_question FROM users WHERE username = ?', (username,))
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def verify_security_answer(self, username, answer):
        self.cursor.execute('SELECT security_answer FROM users WHERE username = ?', (username,))
        result = self.cursor.fetchone()
        return result and result[0] == answer
    
    def reset_password(self, username, new_password):
        self.cursor.execute('UPDATE users SET password_hash = ? WHERE username = ?',
            (generate_password_hash(new_password), username))
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def add_geo_data(self, user_id, data_type, coordinates, properties=None):
        self.cursor.execute('INSERT INTO geo_data (user_id, data_type, coordinates, properties) VALUES (?, ?, ?, ?)',
            (user_id, data_type, coordinates, properties))
        self.conn.commit()
        return self.cursor.lastrowid
    
    def get_user_id(self, username):
        self.cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def __del__(self):
        self.conn.close()

init_db()

# 文件名: Backend/image_processor.py
import torch
import time
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import io
import base64
from typing import Dict, List, Tuple, Optional
from config import config

class ImageProcessor:
    def __init__(self, model, processor, device, font):
        self.model = model
        self.processor = processor
        self.device = device
        self.font = font
        self.colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
    
    @staticmethod
    def non_max_suppression(boxes, scores, threshold=0.5):
        if boxes.numel() == 0:
            return torch.empty((0,), dtype=torch.long)
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort(descending=True)
        keep = []
        while order.numel() > 0:
            if order.numel() == 1:
                i = order.item()
                keep.append(i)
                break
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
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.model.contrast_enhance)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.model.sharpness_enhance)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        return image
    
    def detect_birds(self, image: Image.Image) -> Dict:
        try:
            enhanced_image = self.enhance_image(image)
            roi_image, crop_offset = self.crop_to_roi(enhanced_image, config.model.padding_ratio)
            inputs = self.processor(images=roi_image, return_tensors="pt").to(self.device)
            start_time = time.time()
            with torch.no_grad():
                outputs = self.model(**inputs)
            infer_time = time.time() - start_time
            target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
            results = self.processor.post_process_object_detection(
                outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
            )[0]
            boxes = results["boxes"].cpu()
            scores = results["scores"].cpu()
            labels = results["labels"].cpu()
            keep_indices = self.non_max_suppression(boxes, scores, config.model.nms_threshold)
            boxes = boxes[keep_indices]
            scores = scores[keep_indices]
            labels = labels[keep_indices]
            bird_indices = []
            for i, label in enumerate(labels):
                class_name = self.model.config.id2label[label.item()].lower()
                if "bird" in class_name:
                    bird_indices.append(i)
            if bird_indices:
                bird_indices = torch.tensor(bird_indices, dtype=torch.long)
                results["boxes"] = boxes[bird_indices]
                results["scores"] = scores[bird_indices]
                results["labels"] = labels[bird_indices]
                if len(results["boxes"]) > 0:
                    results["boxes"][:, 0] += crop_offset[0]
                    results["boxes"][:, 1] += crop_offset[1]
                    results["boxes"][:, 2] += crop_offset[0]
                    results["boxes"][:, 3] += crop_offset[1]
            else:
                results["boxes"] = torch.tensor([])
                results["scores"] = torch.tensor([])
                results["labels"] = torch.tensor([])
            return {"results": results, "inference_time": infer_time, "original_image": image, "crop_offset": crop_offset}
        except Exception as e:
            raise Exception(f"鸟类检测失败: {str(e)}")
    
    def draw_detection_results(self, detection_result: Dict) -> Image.Image:
        image = detection_result["original_image"]
        results = detection_result["results"]
        infer_time = detection_result["inference_time"]
        draw = ImageDraw.Draw(image)
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=self.font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = self.model.config.id2label[label.item()]
            color = self.colors[i % len(self.colors)]
            detected_objects.append({"class": class_name, "score": float(score), "box": box})
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
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
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()
    
    def process_single_image(self, image: Image.Image, filename: str = "") -> Dict:
        try:
            detection_result = self.detect_birds(image)
            result_image, detected_objects, object_count = self.draw_detection_results(detection_result)
            img_str = self.image_to_base64(result_image)
            return {"success": True, "filename": filename, "image": img_str, "count": object_count, "inference_time": detection_result["inference_time"], "objects": detected_objects}
        except Exception as e:
            return {"success": False, "filename": filename, "error": str(e)}

# 文件名: Backend/model_manager.py
import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import time
import io
import base64
from config import config

class ModelManager:
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = None
        self.font = None
        self.is_initialized = False
    
    def initialize(self):
        try:
            print("正在加载模型...")
            self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
            self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(self.device)
            print(f"使用设备: {self.device.type.upper()}")
            self._load_font()
            self.is_initialized = True
            print("模型加载完成")
        except Exception as e:
            print(f"模型初始化失败: {e}")
            raise
    
    def _load_font(self):
        try:
            self.font = ImageFont.truetype("simhei.ttf", 20)
        except IOError:
            try:
                self.font = ImageFont.truetype("simsun.ttc", 20)
            except IOError:
                self.font = ImageFont.load_default()
                print("警告: 无法加载中文字体，将使用默认字体")
    
    def non_max_suppression(self, boxes, scores, threshold=0.5):
        if boxes.numel() == 0:
            return torch.empty((0,), dtype=torch.long)
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort(descending=True)
        keep = []
        while order.numel() > 0:
            if order.numel() == 1:
                i = order.item()
                keep.append(i)
                break
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
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.model.contrast_enhance)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.model.sharpness_enhance)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        return image
    
    def detect_birds(self, image, filename=""):
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        try:
            processed_image = self.preprocess_image(image)
            roi_image, crop_offset = self.crop_to_roi(processed_image, config.model.padding_ratio)
            inputs = self.processor(images=roi_image, return_tensors="pt").to(self.device)
            start_time = time.time()
            with torch.no_grad():
                outputs = self.model(**inputs)
            infer_time = time.time() - start_time
            target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
            results = self.processor.post_process_object_detection(
                outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
            )[0]
            boxes = results["boxes"].cpu()
            scores = results["scores"].cpu()
            labels = results["labels"].cpu()
            keep_indices = self.non_max_suppression(boxes, scores, config.model.nms_threshold)
            boxes = boxes[keep_indices]
            scores = scores[keep_indices]
            labels = labels[keep_indices]
            bird_indices = []
            for i, label in enumerate(labels):
                class_name = self.model.config.id2label[label.item()].lower()
                if "bird" in class_name:
                    bird_indices.append(i)
            if bird_indices:
                bird_indices = torch.tensor(bird_indices, dtype=torch.long)
                results["boxes"] = boxes[bird_indices]
                results["scores"] = scores[bird_indices]
                results["labels"] = labels[bird_indices]
                if len(results["boxes"]) > 0:
                    results["boxes"][:, 0] += crop_offset[0]
                    results["boxes"][:, 1] += crop_offset[1]
                    results["boxes"][:, 2] += crop_offset[0]
                    results["boxes"][:, 3] += crop_offset[1]
            else:
                results["boxes"] = torch.tensor([])
                results["scores"] = torch.tensor([])
                results["labels"] = torch.tensor([])
            return {"results": results, "inference_time": infer_time, "original_image": image, "crop_offset": crop_offset}
        except Exception as e:
            raise RuntimeError(f"检测失败: {e}")
    
    def visualize_results(self, detection_result, filename=""):
        image = detection_result["original_image"]
        results = detection_result["results"]
        infer_time = detection_result["inference_time"]
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: {config.model.model_name}", fill="white", font=self.font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = self.model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            detected_objects.append({"class": class_name, "score": float(score), "box": box})
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            try:
                bbox = draw.textbbox((0, 0), label_text, font=self.font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=self.font)
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=self.font)
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        return {"image": img_str, "count": object_count, "objects": detected_objects, "inference_time": infer_time}

model_manager = ModelManager()

# 文件名: Backend/modelservice.py
import torch
import time
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
from config import config
import logging

logger = logging.getLogger(__name__)

class ModelService:
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = None
        self.font = None
        self._initialized = False
    
    def initialize(self):
        try:
            logger.info("正在加载模型...")
            self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
            self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(self.device)
            logger.info(f"使用设备: {self.device.type.upper()}")
            self._load_font()
            self._initialized = True
            logger.info("模型加载完成")
            return True
        except Exception as e:
            logger.error(f"模型初始化失败: {e}")
            self._initialized = False
            return False
    
    def _load_font(self):
        try:
            self.font = ImageFont.truetype("simhei.ttf", 20)
        except IOError:
            try:
                self.font = ImageFont.truetype("simsun.ttc", 20)
            except IOError:
                self.font = ImageFont.load_default()
                logger.warning("无法加载中文字体，将使用默认字体")
    
    def non_max_suppression(self, boxes, scores, threshold=config.model.nms_threshold):
        if boxes.numel() == 0:
            return torch.empty((0,), dtype=torch.long)
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort(descending=True)
        keep = []
        while order.numel() > 0:
            if order.numel() == 1:
                i = order.item()
                keep.append(i)
                break
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
    
    def crop_to_roi(self, image, padding=config.model.padding_ratio):
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
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.model.contrast_enhance)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.model.sharpness_enhance)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        return image
    
    def detect_birds(self, image, filename=""):
        if not self._initialized:
            raise RuntimeError("模型未初始化")
        try:
            processed_image = self.preprocess_image(image)
            roi_image, crop_offset = self.crop_to_roi(processed_image)
            inputs = self.processor(images=roi_image, return_tensors="pt").to(self.device)
            start_time = time.time()
            with torch.no_grad():
                outputs = self.model(**inputs)
            infer_time = time.time() - start_time
            target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
            results = self.processor.post_process_object_detection(
                outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
            )[0]
            boxes = results["boxes"].cpu()
            scores = results["scores"].cpu()
            labels = results["labels"].cpu()
            keep_indices = self.non_max_suppression(boxes, scores)
            boxes = boxes[keep_indices]
            scores = scores[keep_indices]
            labels = labels[keep_indices]
            bird_indices = []
            for i, label in enumerate(labels):
                class_name = self.model.config.id2label[label.item()].lower()
                if "bird" in class_name:
                    bird_indices.append(i)
            if bird_indices:
                bird_indices = torch.tensor(bird_indices, dtype=torch.long)
                results["boxes"] = boxes[bird_indices]
                results["scores"] = scores[bird_indices]
                results["labels"] = labels[bird_indices]
                if len(results["boxes"]) > 0:
                    results["boxes"][:, 0] += crop_offset[0]
                    results["boxes"][:, 1] += crop_offset[1]
                    results["boxes"][:, 2] += crop_offset[0]
                    results["boxes"][:, 3] += crop_offset[1]
            else:
                results["boxes"] = torch.tensor([])
                results["scores"] = torch.tensor([])
                results["labels"] = torch.tensor([])
            return {"results": results, "inference_time": infer_time, "crop_offset": crop_offset, "original_image": image}
        except Exception as e:
            logger.error(f"鸟类检测失败: {e}")
            raise
    
    def visualize_results(self, detection_result):
        image = detection_result["original_image"]
        results = detection_result["results"]
        infer_time = detection_result["inference_time"]
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: {config.model.model_name}", fill="white", font=self.font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = self.model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            detected_objects.append({"class": class_name, "score": float(score), "box": box})
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            try:
                bbox = draw.textbbox((0, 0), label_text, font=self.font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=self.font)
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=self.font)
        return image, detected_objects, object_count

model_service = ModelService()

# 文件名: utils/__init__.py
from .image_processor import ImageProcessor
from .model_manager import ModelManager
from .logger import setup_logger
from .error_handler import APIError, handle_api_error

__all__ = ['ImageProcessor', 'ModelManager', 'setup_logger', 'APIError', 'handle_api_error']

# 文件名: utils/image_processor.py
import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import time
import base64
import io
from typing import Dict, List, Tuple, Optional
from config import config

class ImageProcessor:
    def __init__(self):
        self.config = config.model
        self.font = self._load_font()
    
    def _load_font(self) -> ImageFont.FreeTypeFont:
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
        if boxes.numel() == 0:
            return torch.empty((0,), dtype=torch.long)
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort(descending=True)
        keep = []
        while order.numel() > 0:
            if order.numel() == 1:
                i = order.item()
                keep.append(i)
                break
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
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(self.config.contrast_enhance)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(self.config.sharpness_enhance)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        return image
    
    def draw_detection_results(self, image: Image.Image, results: Dict, crop_offset: Tuple[int, int], infer_time: float) -> Tuple[Image.Image, List[Dict]]:
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=self.font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=self.font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=self.font)
        detected_objects = []
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = results["class_names"][i]
            color = colors[i % len(colors)]
            detected_objects.append({"class": class_name, "score": float(score), "box": box})
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
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
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()

# 文件名: utils/logger.py
import logging
import os
from datetime import datetime
from typing import Optional

def setup_logger(name: str = "visual_parts", level: int = logging.INFO, log_file: Optional[str] = None, format_string: Optional[str] = None) -> logging.Logger:
    if format_string is None:
        format_string = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    logger = logging.getLogger(name)
    logger.setLevel(level)
    if logger.handlers:
        return logger
    formatter = logging.Formatter(format_string)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    return logger

def get_api_logger() -> logging.Logger:
    return setup_logger(name="visual_parts.api", log_file="logs/api.log")

def get_auth_logger() -> logging.Logger:
    return setup_logger(name="visual_parts.auth", log_file="logs/auth.log")

def get_detection_logger() -> logging.Logger:
    return setup_logger(name="visual_parts.detection", log_file="logs/detection.log")

def log_api_request(logger: logging.Logger, endpoint: str, method: str, status_code: int, processing_time: float, user_agent: str = None):
    logger.info(f"API Request - {method} {endpoint} - Status: {status_code} - Time: {processing_time:.3f}s - UserAgent: {user_agent or 'Unknown'}")

def log_detection_result(logger: logging.Logger, filename: str, count: int, inference_time: float, success: bool = True):
    status = "成功" if success else "失败"
    logger.info(f"Detection Result - 文件: {filename} - 检测数量: {count} - 推理时间: {inference_time:.3f}s - 状态: {status}")

def log_error(logger: logging.Logger, error_type: str, error_message: str, stack_trace: str = None):
    logger.error(f"Error - 类型: {error_type} - 消息: {error_message}")
    if stack_trace:
        logger.debug(f"Stack Trace: {stack_trace}")

default_logger = setup_logger()

# 文件名: utils/model_manager.py
import torch
from transformers import DetrImageProcessor, DetrForObjectDetection
import time
from typing import Dict, Any
from config import config

class ModelManager:
    def __init__(self):
        self.processor = None
        self.model = None
        self.device = None
        self.is_initialized = False
    
    def initialize_model(self) -> bool:
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
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        return self.processor(images=image, return_tensors="pt").to(self.device)
    
    def inference(self, inputs: Dict[str, torch.Tensor]) -> Dict[str, Any]:
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        start_time = time.time()
        with torch.no_grad():
            outputs = self.model(**inputs)
        infer_time = time.time() - start_time
        return {"outputs": outputs, "inference_time": infer_time}
    
    def post_process(self, outputs, target_sizes) -> Dict[str, torch.Tensor]:
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        results = self.processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
        )[0]
        return results
    
    def get_model_config(self):
        if not self.is_initialized:
            raise RuntimeError("模型未初始化")
        return self.model.config
    
    def is_ready(self) -> bool:
        return self.is_initialized
    
    def get_device_info(self) -> str:
        if self.device:
            return f"{self.device.type.upper()}"
        return "未初始化"

# 文件名: identification/app.py
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import sys
import uuid
import base64
from datetime import datetime
from werkzeug.utils import secure_filename

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from identification.model.transformer import detect_objects

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'identification/result'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    image_file = request.files['image']
    if image_file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if not allowed_file(image_file.filename):
        return jsonify({'error': 'Invalid file type'}), 400
    try:
        image_data = image_file.read()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"detection_{timestamp}_{unique_id}.jpg"
        save_path = os.path.join(UPLOAD_FOLDER, filename)
        result_json = detect_objects(image_data, return_type='json')
        result_image = detect_objects(image_data, return_type='image')
        with open(save_path, 'wb') as f:
            f.write(base64.b64decode(result_image))
        response = {'success': True, 'result': result_json, 'image_path': save_path, 'image_url': f'/result/{filename}'}
        return jsonify(response), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/result/<filename>')
def serve_result(filename):
    return send_file(os.path.join(UPLOAD_FOLDER, filename))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

# 文件名: identification/model/transformer.py
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import torch
import time
import base64
import io
import json

def crop_to_roi(image):
    return image, (0, 0)

MODELS = {
    "detr-resnet-50": {"processor": "facebook/detr-resnet-50", "model": "facebook/detr-resnet-50"},
    "detr-resnet-101": {"processor": "facebook/detr-resnet-101", "model": "facebook/detr-resnet-101"},
    "detr-resnet-101-dc5": {"processor": "facebook/detr-resnet-101-dc5", "model": "facebook/detr-resnet-101-dc5"}
}

current_model = "detr-resnet-101-dc5"
processor = DetrImageProcessor.from_pretrained(MODELS[current_model]["processor"], size={"shortest_edge": 800, "longest_edge": 1333})
model = DetrForObjectDetection.from_pretrained(MODELS[current_model]["model"])
model.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))

def detect_objects(image_data, return_type='json', model_version=None):
    global current_model, processor, model
    if model_version and model_version in MODELS and model_version != current_model:
        current_model = model_version
        processor = DetrImageProcessor.from_pretrained(MODELS[current_model]["processor"], size={"shortest_edge": 800, "longest_edge": 1333})
        model = DetrForObjectDetection.from_pretrained(MODELS[current_model]["model"])
        model.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    if isinstance(image_data, str):
        image = Image.open(io.BytesIO(base64.b64decode(image_data)))
    else:
        image = Image.open(io.BytesIO(image_data))
    original_size = image.size
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(2.0)
    enhancer = ImageEnhance.Sharpness(image)
    image = enhancer.enhance(1.5)
    image = image.filter(ImageFilter.MedianFilter(size=3))
    roi_image, crop_offset = crop_to_roi(image)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    inputs = processor(images=roi_image, return_tensors="pt").to(device)
    start_time = time.time()
    with torch.no_grad():
        outputs = model(**inputs)
    infer_time = time.time() - start_time
    target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
    results = processor.post_process_object_detection(outputs, target_sizes=target_sizes, threshold=0.6)[0]
    detection_results = {"objects": [], "count": 0, "inference_time": infer_time, "original_size": original_size, "model": "DETR-ResNet101-DC5"}
    if return_type == 'image':
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype("simhei.ttf", 20)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: {detection_results['model']}", fill="white", font=font)
        draw.text([5, 30], f"检测数量: {detection_results['count']}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        for i, obj in enumerate(detection_results['objects']):
            box = obj['box']
            class_name = obj['class']
            score = obj['score']
            color = colors[i % len(colors)]
            draw.rectangle(box, outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=font)
            draw.rectangle([box[0], box[1] - text_height - 5, box[0] + text_width + 5, box[1]], fill=color)
            draw.text([box[0] + 2, box[1] - text_height - 5], label_text, fill="white", font=font)
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
    return json.dumps(detection_results)

# 文件名: extra/clip.py
import os
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from rasterio.crs import CRS

def clip_raster_by_shp(raster_folder, shp_path, output_folder):
    gdf = gpd.read_file(shp_path)
    folder_name = os.path.basename(raster_folder)
    new_output_folder = os.path.join(output_folder, folder_name)
    if not os.path.exists(new_output_folder):
        os.makedirs(new_output_folder)
    raster_files = [f for f in os.listdir(raster_folder) if f.endswith('.tif')]
    for raster_file in raster_files:
        raster_path = os.path.join(raster_folder, raster_file)
        with rasterio.open(raster_path) as src:
            src_meta = src.meta
            if src.crs:
                gdf_crs = CRS.from_user_input(gdf.crs) if gdf.crs else None
                src_crs = CRS.from_user_input(src.crs) if src.crs else None
                if gdf_crs != src_crs:
                    gdf_projected = gdf.to_crs(src.crs)
                else:
                    gdf_projected = gdf
            else:
                gdf_projected = gdf
            for index, row in gdf_projected.iterrows():
                geometry_projected = row['geometry']
                out_image, out_transform = mask(src, [geometry_projected], crop=True)
                out_meta = src_meta.copy()
                out_meta.update({"driver": "GTiff", "height": out_image.shape[1], "width": out_image.shape[2], "transform": out_transform})
                base_filename = os.path.splitext(raster_file)[0]
                out_filename = os.path.join(new_output_folder, f"{base_filename}_clip_{index}.tif")
                with rasterio.open(out_filename, "w", **out_meta) as dest:
                    dest.write(out_image)

raster_folder = r"./data/weather/wc2.1_cruts4.09_2.5m_tmin_2020-2024"
shp_path = r"./data/boundary/TW_boundary.shp"
output_folder = r"./data/weather/cliped"
clip_raster_by_shp(raster_folder, shp_path, output_folder)

# 文件名: extra identification/批处理.py
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import torch
import time
import os
from tkinter import Tk, filedialog

def non_max_suppression(boxes, scores, threshold=0.5):
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.long)
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort(descending=True)
    keep = []
    while order.numel() > 0:
        if order.numel() == 1:
            i = order.item()
            keep.append(i)
            break
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

def process_image(image_path, output_dir, processor, model, device, font):
    try:
        image = Image.open(image_path)
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.5)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        roi_image, crop_offset = crop_to_roi(image)
        inputs = processor(images=roi_image, return_tensors="pt").to(device)
        start_time = time.time()
        with torch.no_grad():
            outputs = model(**inputs)
        infer_time = time.time() - start_time
        target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
        results = processor.post_process_object_detection(outputs, target_sizes=target_sizes, threshold=0.6)[0]
        boxes = results["boxes"].cpu()
        scores = results["scores"].cpu()
        labels = results["labels"].cpu()
        keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
        boxes = boxes[keep_indices]
        scores = scores[keep_indices]
        labels = labels[keep_indices]
        bird_indices = []
        for i, label in enumerate(labels):
            class_name = model.config.id2label[label.item()].lower()
            if "bird" in class_name:
                bird_indices.append(i)
        bird_indices = torch.tensor(bird_indices, dtype=torch.long)
        results["boxes"] = boxes[bird_indices]
        results["scores"] = scores[bird_indices]
        results["labels"] = labels[bird_indices]
        if len(results["boxes"]) > 0:
            results["boxes"][:, 0] += crop_offset[0]
            results["boxes"][:, 1] += crop_offset[1]
            results["boxes"][:, 2] += crop_offset[0]
            results["boxes"][:, 3] += crop_offset[1]
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        print(f"\n{os.path.basename(image_path)} 检测到 {object_count} 只鸟类")
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            class_name = model.config.id2label[label.item()]
            print(f"鸟类 {i+1}: {class_name} (置信度: {score:.2f})")
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=font)
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=font)
        output_filename = f"result_{os.path.basename(image_path)}"
        result_path = os.path.join(output_dir, output_filename)
        image.save(result_path)
        print(f"结果已保存至: {result_path}")
    except Exception as e:
        print(f"处理 {image_path} 时出错: {str(e)}")

def main():
    root = Tk()
    root.withdraw()
    print("请选择包含图片的文件夹...")
    input_dir = filedialog.askdirectory(title="选择图片文件夹")
    if not input_dir:
        print("未选择文件夹，程序退出")
        return
    output_dir = os.path.join(input_dir, "鸟类识别结果")
    os.makedirs(output_dir, exist_ok=True)
    supported_formats = ('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.webp')
    image_files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f)) and f.lower().endswith(supported_formats)]
    if not image_files:
        print(f"在 {input_dir} 中未找到支持的图片文件")
        return
    print(f"找到 {len(image_files)} 个图片文件，开始处理...")
    processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-101-dc5")
    model = DetrForObjectDetection.from_pretrained("facebook/detr-resnet-101-dc5")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    print(f"使用设备: {device.type.upper()}")
    try:
        font = ImageFont.truetype("simhei.ttf", 20)
    except IOError:
        try:
            font = ImageFont.truetype("simsun.ttc", 20)
        except IOError:
            font = ImageFont.load_default()
            print("警告: 无法加载中文字体，将使用默认字体")
    for i, image_file in enumerate(image_files, 1):
        image_path = os.path.join(input_dir, image_file)
        print(f"\n处理第 {i}/{len(image_files)} 个文件: {image_file}")
        process_image(image_path, output_dir, processor, model, device, font)
    print("\n所有图片处理完成！")
    print(f"所有结果已保存至: {output_dir}")

if __name__ == "__main__":
    main()

# 文件名: js/api.js
const OVERRIDE_BASE = window.API_BASE_URL || localStorage.getItem('API_BASE_URL');
const isLocalhost = window.location.hostname === 'localhost';
const BASE_URL = OVERRIDE_BASE !== null && OVERRIDE_BASE !== undefined ? OVERRIDE_BASE : 'http://127.0.0.1:8000';

const request = axios.create({ baseURL: BASE_URL, timeout: 10000 });

request.interceptors.request.use(config => {
    const token = localStorage.getItem('userToken');
    if (token) { config.headers['Authorization'] = `Token ${token}`; }
    return config;
}, error => { return Promise.reject(error); });

request.interceptors.response.use(response => response, error => {
    if (error.response && error.response.status === 401) {
        localStorage.removeItem('userToken');
        localStorage.removeItem('username');
        console.warn('Token 已失效，请重新登录');
    }
    return Promise.reject(error);
});

const API = {
    login: async (username, password) => {
        const form = new URLSearchParams();
        form.append('username', username);
        form.append('password', password);
        return request.post('/api/login/', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    },
    getProfile: () => request.get('/api/profiles/me/'),
    getObservations: () => request.get('/api/observations/'),
    uploadObservation: (file, data) => {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('species', data.species || 1);
        formData.append('count', data.count || 1);
        formData.append('observation_time', data.observation_time || data.date || new Date().toISOString().split('T')[0]);
        if (data.description) formData.append('description', data.description);
        if (data.lat) formData.append('lat', data.lat);
        if (data.lng) formData.append('lng', data.lng);
        if (data.zone) formData.append('zone', data.zone);
        return request.post('/api/observations/', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    getProducts: () => request.get('/api/products/'),
    redeemProduct: (productId) => request.post(`/api/products/${productId}/redeem/`),
    getZones: () => request.get('/api/zones/'),
    getTransects: () => request.get('/api/transects/')
};

window.API = API;

# 文件名: visualheader/main.js
import AuthManager from './auth.js';

const authManager = new AuthManager();

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('register-btn')?.addEventListener('click', () => {
        document.getElementById('popup-register-form').style.display = 'flex';
        document.getElementById('popup-reg-username').focus();
    });

    document.getElementById('popup-cancel-register')?.addEventListener('click', () => {
        document.getElementById('popup-register-form').style.display = 'none';
    });

    document.getElementById('menu-register-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerForm.querySelector('#register-username').focus();
    });

    document.querySelector('[data-target="register-form"]')?.addEventListener('click', () => {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerForm.querySelector('#register-username').focus();
    });

    document.querySelector('[data-target="login-form"]')?.addEventListener('click', () => {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        loginForm.querySelector('#login-username').focus();
    });

    document.getElementById('submit-register')?.addEventListener('click', async () => {
        const username = document.getElementById('reg-username').value;
        const password = document.getElementById('reg-password').value;
        if (!username || !password) {
            alert('请输入用户名和密码');
            return;
        }
        const result = await authManager.register(username, password);
        if (result.success) {
            alert('注册成功');
            document.getElementById('register-form').style.display = 'none';
        } else {
            alert(`注册失败: ${result.message}`);
        }
    });

    document.getElementById('do-logout')?.addEventListener('click', () => {
        authManager.logout();
    });

    authManager.updateAuthUI();
});

# 文件名: visualheader/auth.js
class AuthManager {
    constructor() {
        this.currentUser = localStorage.getItem('username') || null;
    }

    async login(username, password) {
        try {
            const response = await window.API.login(username, password);
            const token = response.data?.token;
            if (!token) {
                const msg = response.data?.message || '登录返回未包含 token';
                return { success: false, message: msg };
            }
            localStorage.setItem('userToken', token);
            localStorage.setItem('username', username);
            this.currentUser = username;
            await this.fetchProfile();
            this.updateAuthUI();
            return { success: true };
        } catch (error) {
            console.error('登录失败:', error);
            const message = error?.response?.data?.error || error.message || '网络错误';
            return { success: false, message };
        }
    }

    async register() {
        return { success: false, message: '当前接口未提供注册功能，请联系管理员开通' };
    }

    async fetchProfile() {
        if (!localStorage.getItem('userToken')) return null;
        try {
            const res = await window.API.getProfile();
            const profile = res.data;
            return profile;
        } catch (error) {
            console.warn('获取用户信息失败', error);
            return null;
        }
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('userToken');
        localStorage.removeItem('username');
        this.updateAuthUI();
        return { success: true };
    }

    updateAuthUI() {
        const authStatus = document.getElementById('auth-status');
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const logoutBtn = document.getElementById('logout-btn');

        if (!authStatus || !loginForm || !registerForm || !logoutBtn) return;

        if (this.currentUser) {
            authStatus.innerHTML = `<span>欢迎, ${this.currentUser}</span>`;
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            logoutBtn.style.display = 'block';
        } else {
            authStatus.innerHTML = '<span>未登录</span>' +
                '<button id="login-btn" class="auth-btn">登录</button>' +
                '<button id="register-btn" class="auth-btn">注册</button>';
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            logoutBtn.style.display = 'none';
        }
    }
}

export default AuthManager;

# 文件名: visualheader/henan.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>河南省科技地图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #province-map { width: 100%; height: 80vh; }
        .back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100; }
        .province-info { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-radius: 8px; }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='tech_map.html'">←返回全国 </button>
    <button class="back-button" onclick="window.location.href='wetland.html'" style="left: 120px;">→郑州黄河湿地自然保护区</button>
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
        const loadingEl = document.createElement('div');
        loadingEl.style.position = 'fixed'; loadingEl.style.top = '50%'; loadingEl.style.left = '50%';
        loadingEl.style.transform = 'translate(-50%, -50%)'; loadingEl.style.color = '#fff';
        loadingEl.textContent = '正在加载地图数据...';
        document.body.appendChild(loadingEl);
        $.get(`https://geo.datav.aliyun.com/areas_v3/bound/410000_full.json`)
            .done(function(geoJson) {
                echarts.registerMap(provinceName, geoJson);
                document.body.removeChild(loadingEl);
                mapChart.setOption({
                    backgroundColor: '#0f1621',
                    title: { text: provinceName, left: 'center', textStyle: { color: '#fff' } },
                    geo: { map: provinceName, roam: true, itemStyle: { areaColor: '#1a2b5a', borderColor: '#0a2dae' }, emphasis: { itemStyle: { areaColor: '#2a91d8' } } }
                });
            });
    </script>
</body>
</html>

# 文件名: visualheader/shandong.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>山东省科技地图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #province-map { width: 100%; height: 80vh; }
        .back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100; }
        .back-button:hover { background: #2a4b8a; box-shadow: 0 0 10px rgba(42, 145, 216, 0.5); }
        .province-info { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 100, 255, 0.2); }
        .province-info h2 { margin-top: 0; color: #00b4ff; border-bottom: 1px solid rgba(0, 180, 255, 0.3); padding-bottom: 10px; }
        .province-info p { color: #b3e0ff; line-height: 1.8; margin: 8px 0; }
        .loading-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center;
            z-index: 2000; flex-direction: column;
        }
        .loading-spinner {
            width: 50px; height: 50px; border: 3px solid rgba(0, 180, 255, 0.3);
            border-top: 3px solid #00b4ff; border-radius: 50%;
            animation: spin 1s linear infinite; margin-bottom: 15px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='tech_map.html'">←返回全国</button>
    <button class="back-button" onclick="window.location.href='henan.html'" style="left: 160px;">→河南省</button>
    <div id="province-map"></div>
    <div class="province-info">
        <h2>山东省信息</h2>
        <p>面积：157100平方公里</p>
        <p>人口：10153万人</p>
        <p>GDP：73129亿元</p>
        <p>主要城市：济南、青岛、烟台、潍坊</p>
        <p>地理特征：濒临黄海和渤海，海岸线长</p>
    </div>
    <script>
        const mapChart = echarts.init(document.getElementById('province-map'));
        const provinceName = '山东省';
        const adcode = '370000';
        
        function showLoading() {
            if (!document.getElementById('loading-overlay')) {
                const loadingEl = document.createElement('div');
                loadingEl.id = 'loading-overlay';
                loadingEl.className = 'loading-overlay';
                loadingEl.innerHTML = '<div class="loading-spinner"></div><div>正在加载地图数据...</div>';
                document.body.appendChild(loadingEl);
            }
        }
        
        function hideLoading() {
            const loadingEl = document.getElementById('loading-overlay');
            if (loadingEl) { loadingEl.remove(); }
        }
        
        function initProvinceMap() {
            showLoading();
            const mapUrl = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
            
            $.get(mapUrl)
                .done(function(geoJson) {
                    echarts.registerMap(provinceName, geoJson);
                    hideLoading();
                    
                    mapChart.setOption({
                        backgroundColor: '#0f1621',
                        title: {
                            text: provinceName + '科技地图',
                            left: 'center',
                            top: 20,
                            textStyle: {
                                color: '#fff',
                                fontSize: 24,
                                fontWeight: 'bold'
                            }
                        },
                        tooltip: {
                            trigger: 'item',
                            backgroundColor: 'rgba(10, 30, 60, 0.9)',
                            borderColor: '#0a2dae',
                            textStyle: { color: '#fff' }
                        },
                        geo: {
                            map: provinceName,
                            roam: true,
                            zoom: 1.2,
                            scaleLimit: { min: 0.5, max: 3 },
                            itemStyle: {
                                areaColor: '#1a2b5a',
                                borderColor: '#0a2dae',
                                borderWidth: 1.5
                            },
                            emphasis: {
                                label: { show: true, color: '#fff', fontSize: 14 },
                                itemStyle: {
                                    areaColor: '#2a91d8',
                                    borderColor: '#00b4ff',
                                    borderWidth: 2
                                }
                            },
                            select: {
                                itemStyle: { areaColor: '#3aadf8' }
                            }
                        },
                        visualMap: {
                            min: 0,
                            max: 10000,
                            text: ['高', '低'],
                            realtime: false,
                            calculable: true,
                            inRange: {
                                color: ['#0a1625', '#1a2b5a', '#2a4b8a', '#3a6ab0', '#4a8ad0']
                            },
                            textStyle: { color: '#fff' },
                            left: 'right',
                            top: 'bottom'
                        }
                    });
                    
                    mapChart.on('click', function(params) {
                        console.log('点击区域:', params.name);
                    });
                    
                    mapChart.on('mouseover', function(params) {
                        console.log('鼠标悬停:', params.name);
                    });
                })
                .fail(function(error) {
                    hideLoading();
                    console.error('地图加载失败:', error);
                    alert('地图数据加载失败，请检查网络连接或稍后重试。');
                });
        }
        
        $(document).ready(function() {
            initProvinceMap();
            
            $(window).resize(function() {
                mapChart.resize();
            });
        });
    </script>
</body>
</html>

# 文件名: visualheader/hebei.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>河北省科技地图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #province-map { width: 100%; height: 80vh; }
        .back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100; transition: all 0.3s ease; }
        .back-button:hover { background: #2a4b8a; box-shadow: 0 0 15px rgba(42, 145, 216, 0.6); transform: translateY(-2px); }
        .back-button:active { transform: translateY(0); }
        .province-info { padding: 20px; background: rgba(10,30,60,0.85); margin: 20px; border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); border: 1px solid rgba(0, 180, 255, 0.3); transition: all 0.3s ease; }
        .province-info:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0, 120, 255, 0.3); }
        .province-info h2 { margin-top: 0; color: #00b4ff; border-bottom: 1px solid rgba(0, 180, 255, 0.3); padding-bottom: 12px; font-size: 1.5em; display: flex; align-items: center; }
        .province-info h2::before { content: ''; display: inline-block; width: 8px; height: 8px; background: #00b4ff; border-radius: 50%; margin-right: 10px; box-shadow: 0 0 10px #00b4ff; }
        .province-info p { color: #b3e0ff; line-height: 1.9; margin: 10px 0; font-size: 0.95em; }
        .data-highlight { color: #00ff88; font-weight: bold; }
        .section-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(0, 180, 255, 0.5), transparent); margin: 15px 0; }
        .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; }
        .stat-item { background: rgba(0, 60, 120, 0.3); padding: 15px; border-radius: 6px; text-align: center; border: 1px solid rgba(0, 180, 255, 0.2); }
        .stat-value { font-size: 1.4em; color: #00ff88; font-weight: bold; margin-bottom: 5px; }
        .stat-label { font-size: 0.85em; color: #b3e0ff; }
        .loading-container {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(135deg, rgba(15, 22, 33, 0.95), rgba(10, 30, 60, 0.95));
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            z-index: 3000; transition: opacity 0.5s ease;
        }
        .loading-pulse {
            width: 60px; height: 60px; border-radius: 50%;
            background: linear-gradient(135deg, #1a2b5a, #2a4b8a);
            position: relative;
            animation: pulse 1.5s ease-in-out infinite;
        }
        .loading-pulse::before, .loading-pulse::after {
            content: ''; position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            border-radius: 50%; border: 2px solid transparent;
        }
        .loading-pulse::before { width: 80px; height: 80px; border-top-color: #00b4ff; animation: spin 1s linear infinite; }
        .loading-pulse::after { width: 60px; height: 60px; border-bottom-color: #00ff88; animation: spin 0.8s linear infinite reverse; }
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; } }
        @keyframes spin { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }
        .loading-text { margin-top: 25px; color: #00b4ff; font-size: 1.1em; letter-spacing: 2px; }
    </style>
</head>
<body>
    <div id="loading-container" class="loading-container">
        <div class="loading-pulse"></div>
        <div class="loading-text">正在加载河北省地图数据...</div>
    </div>
    <button class="back-button" onclick="window.location.href='tech_map.html'">←返回全国</button>
    <button class="back-button" onclick="window.location.href='henan.html'" style="left: 160px;">→河南省</button>
    <div id="province-map"></div>
    <div class="province-info">
        <h2>河北省信息</h2>
        <p>面积：188800平方公里</p>
        <p>人口：7592万人</p>
        <p>GDP：36207亿元</p>
        <div class="section-divider"></div>
        <p>主要城市：石家庄、唐山、保定、邯郸</p>
        <p>地理特征：环绕京津，内陆省份，沿海有秦皇岛、唐山</p>
        <div class="section-divider"></div>
        <div class="stat-grid">
            <div class="stat-item">
                <div class="stat-value">188800</div>
                <div class="stat-label">面积(km²)</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">7592</div>
                <div class="stat-label">人口(万人)</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">36207</div>
                <div class="stat-label">GDP(亿元)</div>
            </div>
        </div>
    </div>
    <script>
        const mapChart = echarts.init(document.getElementById('province-map'));
        const provinceName = '河北省';
        const adcode = '130000';
        
        function removeLoading() {
            const loader = document.getElementById('loading-container');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => { loader.remove(); }, 500);
            }
        }
        
        function loadProvinceData() {
            const mapUrl = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
            
            $.ajax({
                url: mapUrl,
                type: 'GET',
                dataType: 'json',
                success: function(geoJson) {
                    removeLoading();
                    echarts.registerMap(provinceName, geoJson);
                    
                    const option = {
                        backgroundColor: '#0f1621',
                        title: {
                            text: provinceName + '科技地图',
                            subtext: '空天地一体化智能监测平台 - 河北省监测系统',
                            left: 'center',
                            top: 15,
                            textStyle: { color: '#fff', fontSize: 26, fontWeight: 'bold' },
                            subtextStyle: { color: '#b3e0ff', fontSize: 12 }
                        },
                        tooltip: {
                            trigger: 'item',
                            backgroundColor: 'rgba(10, 40, 80, 0.9)',
                            borderColor: '#00b4ff',
                            borderWidth: 1,
                            textStyle: { color: '#fff', fontSize: 13 },
                            padding: [10, 15],
                            formatter: function(params) {
                                return '<div style="font-weight:bold;margin-bottom:5px;">' + params.name + '</div>' +
                                       '<div>监测状态: <span style="color:#00ff88;">正常</span></div>' +
                                       '<div>数据更新时间: ' + new Date().toLocaleString() + '</div>';
                            }
                        },
                        geo: {
                            map: provinceName,
                            roam: true,
                            zoom: 1.3,
                            scaleLimit: { min: 0.8, max: 4 },
                            center: [114.52, 38.05],
                            itemStyle: {
                                areaColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                    { offset: 0, color: '#2a4b8a' },
                                    { offset: 1, color: '#1a2b5a' }
                                ]),
                                borderColor: '#0a2dae',
                                borderWidth: 2,
                                shadowColor: 'rgba(0, 100, 255, 0.3)',
                                shadowBlur: 10
                            },
                            emphasis: {
                                label: { show: true, color: '#fff', fontSize: 16, fontWeight: 'bold' },
                                itemStyle: {
                                    areaColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                        { offset: 0, color: '#3a6ad0' },
                                        { offset: 1, color: '#2a4b8a' }
                                    ]),
                                    borderColor: '#00b4ff',
                                    borderWidth: 3,
                                    shadowColor: 'rgba(0, 150, 255, 0.5)',
                                    shadowBlur: 20
                                }
                            },
                            regions: [
                                { name: '石家庄市', itemStyle: { areaColor: '#2a5aaa' } },
                                { name: '唐山市', itemStyle: { areaColor: '#3a6aaa' } },
                                { name: '秦皇岛市', itemStyle: { areaColor: '#1a3a7a' } },
                                { name: '邯郸市', itemStyle: { areaColor: '#2a4a9a' } }
                            ]
                        },
                        visualMap: {
                            type: 'piecewise',
                            pieces: [
                                { min: 0, max: 1000, label: '0-1000', color: '#1a2b5a' },
                                { min: 1000, max: 3000, label: '1000-3000', color: '#2a4b8a' },
                                { min: 3000, max: 5000, label: '3000-5000', color: '#3a6bba' },
                                { min: 5000, max: 8000, label: '5000-8000', color: '#4a8bea' },
                                { min: 8000, label: '8000+', color: '#00b4ff' }
                            ],
                            textStyle: { color: '#fff' },
                            left: 'left',
                            top: 'bottom',
                            calculable: true
                        },
                        toolbox: {
                            show: true,
                            orient: 'vertical',
                            left: 'right',
                            top: 'center',
                            feature: {
                                saveAsImage: { show: true, title: '保存图片' },
                                restore: { show: true, title: '重置' },
                                dataView: { show: true, title: '数据视图' }
                            },
                            iconStyle: { borderColor: '#00b4ff' }
                        },
                        animationDuration: 2000,
                        animationEasing: 'cubicOut'
                    };
                    
                    mapChart.setOption(option);
                    
                    mapChart.on('click', function(params) {
                        console.log('点击区域:', params.name, 'adcode:', adcode);
                    });
                },
                error: function(xhr, status, error) {
                    console.error('地图加载失败:', error);
                    const loader = document.getElementById('loading-container');
                    if (loader) {
                        loader.innerHTML = '<div style="color:#ff5555;font-size:1.2em;">地图加载失败</div><div style="color:#b3e0ff;margin-top:10px;">请检查网络连接后刷新页面</div>';
                    }
                }
            });
        }
        
        $(document).ready(function() {
            loadProvinceData();
            
            $(window).resize(function() {
                mapChart.resize();
            });
        });
    </script>
</body>
</html>

# 文件名: visualheader/tech_map.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>科技感中国地图</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #china-map { width: 100%; height: 100vh; }
        #back-to-china { position: fixed; top: 20px; right: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; display: none; z-index: 100; }
    </style>
</head>
<body>
    <div id="china-map"></div>
    <button id="back-to-china">返回全国视图</button>
    <button id="back-to-main" style="position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100;">返回主平台</button>
    <script>
        $(function() {
            const mapChart = echarts.init(document.getElementById('china-map'));
            const techMapOption = {
                backgroundColor: '#0f1621',
                geo: {
                    map: 'china', roam: true,
                    itemStyle: { areaColor: '#1a2b5a', borderColor: '#0a2dae', borderWidth: 2, shadowColor: 'rgba(0, 0, 0, 0.5)', shadowBlur: 10 },
                    emphasis: { itemStyle: { areaColor: '#2a91d8', borderWidth: 3 }, label: { show: true, color: '#fff', fontSize: 14 } }
                }
            };
            $.get('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json', function(geoJson) {
                echarts.registerMap('china', geoJson);
                mapChart.setOption(techMapOption);
                mapChart.on('click', function(params) {
                    const safeParams = { name: params.name, componentType: params.componentType, geoIndex: params.geoIndex };
                    console.log('安全事件参数:', safeParams);
                    if (params.componentType === 'geo') {
                        const provinceMap = {
                            '北京市': 'beijing.html', '北京': 'beijing.html', '天津': 'tianjin.html', '河北': 'hebei.html',
                            '山西': 'shanxi.html', '内蒙古': 'neimenggu.html', '辽宁': 'liaoning.html', '吉林': 'jilin.html',
                            '黑龙江': 'heilongjiang.html', '上海': 'shanghai.html', '江苏': 'jiangsu.html', '浙江': 'zhejiang.html',
                            '安徽': 'anhui.html', '福建': 'fujian.html', '江西': 'jiangxi.html', '山东': 'shandong.html',
                            '河南': 'henan.html', '湖北': 'hubei.html', '湖南': 'hunan.html', '广东': 'guangdong.html',
                            '广西': 'guangxi.html', '海南': 'hainan.html', '重庆': 'chongqing.html', '四川': 'sichuan.html',
                            '贵州': 'guizhou.html', '云南': 'yunnan.html', '西藏': 'xizang.html', '陕西': 'shanxi1.html',
                            '甘肃': 'gansu.html', '青海': 'qinghai.html', '宁夏': 'ningxia.html', '新疆': 'xinjiang.html',
                            '台湾': 'taiwan.html', '香港': 'hongkong.html', '澳门': 'macao.html'
                        };
                        const matchedKey = Object.keys(provinceMap).find(key => key.includes(params.name) || params.name.includes(key));
                        if(matchedKey) {
                            const basePath = window.location.href.replace('tech_map.html', '');
                            const targetUrl = basePath + provinceMap[matchedKey];
                            setTimeout(() => {
                                fetch(targetUrl, {method: 'HEAD'}).then(response => {
                                    if(response.ok) { window.location.href = targetUrl; }
                                    else { alert('抱歉，该省份页面暂不可用'); }
                                }).catch(error => { alert('跳转过程中发生错误'); });
                            }, 100);
                        }
                    }
                });
            });
            $('#back-to-main').click(function() { window.location.href = '../visualheader/testB.html'; });
            $('#back-to-china').click(function() { mapChart.setOption(techMapOption); $(this).hide(); });
        });
    </script>
</body>
</html>

# 文件名: visualheader/rain.html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>空天地一体化可视化平台</title>
<style>
    body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; background: #0a1625; color: #fff; min-height: 100vh; position: relative; overflow-x: hidden; }
    body::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(rgba(0, 120, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 120, 255, 0.1) 1px, transparent 1px); background-size: 40px 40px; z-index: -1; }
    h1 { text-align: center; padding: 25px; font-size: 2.8em; text-shadow: 0 0 15px rgba(0, 180, 255, 0.7); margin: 0; background: rgba(0, 40, 80, 0.5); border-bottom: 1px solid rgba(0, 180, 255, 0.3); }
    .dashboard { display: flex; flex-direction: column; height: 80vh; padding: 30px; margin: 0 auto; width: 90%; min-width: 800px; max-width: 1300px; }
    .module { background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding: 25px; box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px); border: 1px solid rgba(0, 180, 255, 0.3); transition: all 0.3s ease; }
    .module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0, 120, 255, 0.3); }
    .module h2 { margin-top: 0; color: #00b4ff; padding-bottom: 15px; font-size: 1.6em; border-bottom: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; }
    .module h2::before { content: ""; display: inline-block; width: 10px; height: 10px; background: #00b4ff; border-radius: 50%; margin-right: 10px; box-shadow: 0 0 8px #00b4ff; }
    .module p { color: #b3e0ff; line-height: 1.7; margin-bottom: 20px; }
    .chart-container { height: 500px; background: rgba(0, 80, 160, 0.2); border-radius: 6px; border: 1px dashed rgba(0, 180, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #66c2ff; font-size: 1.1em; }
    .status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #00ff88; box-shadow: 0 0 8px #00ff88; margin-right: 8px; }
    .target-recognition { margin-top: 20px; padding: 15px; background: rgba(0, 80, 160, 0.3); border-radius: 6px; border: 2px dashed rgba(0, 180, 255, 0.5); }
    .target-recognition h3 { color: #00ffaa; margin-top: 0; font-size: 1.2em; }
    .recognition-box { height: 120px; background: rgba(0, 60, 120, 0.2); border: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #66ffcc; }
</style>
</head>
<body>
<h1>空天地一体化可视化平台</h1>
<div class="dashboard">
    <div class="module">
        <h2><span class="status-indicator"></span>降水量</h2>
        <p>目标分布降水量展示</p>
        <div class="chart-container">降水量展示</div>
    </div>
</div>
</body>
</html>

# 文件名: visualheader/testB.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>郑州黄河湿地空天地一体化智能监测平台</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; background: #0a1625; color: #fff; min-height: 100vh; position: relative; overflow-x: hidden; transition: margin-left 0.5s; }
        body::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(rgba(0, 120, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 120, 255, 0.1) 1px, transparent 1px); background-size: 40px 40px; z-index: -1; }
        h1 { text-align: center; padding: 25px; font-size: 2.8em; text-shadow: 0 0 15px rgba(0, 180, 255, 0.7); margin: 0; background: rgba(0, 40, 80, 0.5); border-bottom: 1px solid rgba(0, 180, 255, 0.3); }
        .container { display: flex; justify-content: space-between; align-items: flex-start; padding: 30px; max-width: 1400px; margin-left: 60px; transition: margin-left 0.5s; }
        .container-expanded { margin-left: 210px; }
        .sidebar { display: flex; flex-direction: column; gap: 25px; width: 200px; }
        .sidebar-collapsed { width: 50px; height: 100vh; position: fixed; left: 0; top: 0; background: rgba(10, 30, 60, 0.9); z-index: 1000; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 20px; border-right: 1px solid rgba(0, 180, 255, 0.3); transition: width 0.3s; }
        .sidebar-expanded { width: 200px; }
        .sidebar-menu { display: none; width: 100%; padding: 10px; }
        .sidebar-expanded .sidebar-menu { display: block; }
        .sidebar-menu-item { padding: 10px; color: #b3e0ff; cursor: pointer; border-bottom: 1px solid rgba(0, 180, 255, 0.2); transition: all 0.3s; }
        .sidebar-menu-item:hover { background: rgba(0, 100, 255, 0.2); color: #00ff88; }
        .module { background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding: 10px; box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px); border: 1px solid rgba(0, 180, 255, 0.3); transition: all 0.3s ease; cursor: pointer; position: relative; display: none; opacity: 0; transform: translateY(20px); transition: opacity 0.3s, transform 0.3s; }
        .module.active { display: block; opacity: 1; transform: translateY(0); }
        .module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0, 120, 255, 0.3); }
        .module h2 { margin-top: 0; color: #00b4ff; padding-bottom: 5px; font-size: 1.4em; border-bottom: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; }
        .module h2::before { content: ""; display: inline-block; width: 10px; height: 10px; background: #00b4ff; border-radius: 50%; margin-right: 10px; box-shadow: 0 0 8px #00b4ff; }
        .module p { color: #b3e0ff; line-height: 1.7; margin-bottom: 10px; }
        .chart-container { display: none; width: 600px; height: 400px; background: rgba(0, 80, 160, 0.2); border-radius: 6px; border: 1px dashed rgba(0, 180, 255, 0.3); color: #66c2ff; font-size: 1.1em; position: absolute; top: 150px; left: 50%; transform: translateX(-50%); z-index: 1; }
        .chart-container.show { display: block; }
        .status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #00ff88; box-shadow: 0 0 8px #00ff88; margin-right: 8px; }
        .target-recognition-container { display: flex; justify-content: center; align-items: center; padding: 30px; }
        .target-recognition-module { background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding: 10px; box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px); border: 1px solid rgba(0, 180, 255, 0.3); transition: all 0.3s ease; cursor: pointer; width: 600px; height: 400px; position: relative; }
        .target-recognition-module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0, 120, 255, 0.3); }
        .recognition-box { height: 300px; background: rgba(0, 60, 120, 0.2); border: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #66c2ff; }
        .login-page { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 10, 20, 0.9); z-index: 2000; align-items: center; justify-content: center; }
        .login-form-container { background: rgba(10, 30, 60, 0.95); padding: 30px; border-radius: 10px; width: 350px; box-shadow: 0 0 50px rgba(0, 100, 255, 0.3); border: 1px solid rgba(0, 180, 255, 0.5); }
        .login-form-container h2 { color: #00b4ff; text-align: center; margin-bottom: 25px; font-size: 1.8em; }
        .login-form-container input { width: 100%; padding: 12px; margin: 10px 0; background: rgba(0, 40, 80, 0.5); border: 1px solid rgba(0, 180, 255, 0.3); color: white; border-radius: 4px; }
        .auth-container { position: absolute; top: 20px; right: 20px; z-index: 1000; }
        .auth-status { background: rgba(10, 30, 60, 0.8); padding: 10px 15px; border-radius: 20px; color: #b3e0ff; display: flex; align-items: center; gap: 10px; }
        .auth-btn { background: rgba(0, 120, 255, 0.3); color: white; border: 1px solid rgba(0, 180, 255, 0.5); padding: 5px 10px; border-radius: 4px; cursor: pointer; transition: all 0.3s; }
        .auth-btn:hover { background: rgba(0, 120, 255, 0.5); }
        .upload-area { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 20px; border: 2px dashed rgba(0, 180, 255, 0.5); border-radius: 8px; margin-bottom: 20px; }
        .detect-button { background: rgba(0, 200, 100, 0.3); color: white; border: 1px solid rgba(0, 255, 128, 0.5); padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.3s; margin-top: 15px; display: none; }
        .detect-button:hover { background: rgba(0, 200, 100, 0.5); }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script src="./auth.js" type="module"></script>
    <script>
        let batchMode = false;
        let batchFiles = [];
        let batchResults = [];
        
        document.addEventListener('DOMContentLoaded', function() {
            const sidebar = document.createElement('div');
            sidebar.className = 'sidebar-collapsed';
            sidebar.innerHTML = `<div class="profile-icon"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJDNi40NzkgMiAyIDYuNDc5IDIgMTJzNC40NzkgMTAgMTAgMTAgMTAtNC40NzkgMTAtMTBTMTcuNTIxIDIgMTIgMnptMCAyYzQuNDE5IDAgOCAzLjU4MSA4IDhzLTMuNTgxIDgtOCA4LTgtMy41ODEtOC04IDMuNTgxLTggOC04em0wIDJjLTIuMjA5IDAtNCAxLjc5MS00IDQgMCAxLjMwMy43ODcgMi40MDQgMS45NzcgMi45MDFDNy45MjUgMTIuODQ0IDcgMTEuNTU3IDcgMTBjMC0yLjc2MSAyLjIzOS01IDUtNXM1IDIuMjM5IDUgNWMwIDEuNTU3LS45MjUgMi44NDQtMi4yNzcgMy40MDFDMTYuMjEzIDEyLjQwNCAxNyAxMS4zMDMgMTcgMTBjMC0yLjIwOS0xLjc5MS00LTQtNHoiIGZpbGw9IiMwMGI0ZmYiLz48L3N2Zz4=" alt="Profile"></div><div class="sidebar-menu"><div class="sidebar-menu-item" data-target="login-form">登录</div><div class="sidebar-menu-item" data-target="real-time-monitor">实时监控</div><div class="sidebar-menu-item" data-target="temperature-monitor">温度监控</div><div class="sidebar-menu-item" data-target="humidity-monitor">湿度监控</div><div class="sidebar-menu-item" data-target="distribution-monitor">分布监控</div><div class="sidebar-menu-item" data-target="precipitation-monitor">降水监控</div><div class="sidebar-menu-item" data-target="target-recognition-module">目标识别</div></div>`;
            document.body.insertBefore(sidebar, document.body.firstChild);
            sidebar.addEventListener('click', function(e) {
                if (e.target.classList.contains('sidebar-icon') || e.target.classList.contains('sidebar-collapsed')) {
                    sidebar.classList.toggle('sidebar-expanded');
                    document.querySelector('.container').classList.toggle('container-expanded');
                }
            });
            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('sidebar-menu-item')) {
                    const targetId = e.target.getAttribute('data-target');
                    const targetElement = document.getElementById(targetId);
                    if (targetElement) {
                        targetElement.classList.toggle('active');
                        if (targetId === 'target-recognition-module') {
                            const container = document.querySelector('.target-recognition-container');
                            container.style.display = container.style.display === 'none' ? 'flex' : 'none';
                        }
                    }
                }
            });
            interact('.chart-container').draggable({ inertia: false, autoScroll: false, listeners: { move: dragMoveListener } });
            interact('.module:not(#target-recognition-module)').draggable({ inertia: false, autoScroll: false, listeners: { move: dragMoveListener } });
            function dragMoveListener(event) {
                const target = event.target;
                const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
                const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
                target.style.transform = `translate(${x}px, ${y}px)`;
                target.setAttribute('data-x', x);
                target.setAttribute('data-y', y);
            }
            document.querySelectorAll('.module h2').forEach(header => {
                header.addEventListener('click', function() {
                    const chartContainer = this.parentElement.querySelector('.chart-container');
                    if (chartContainer) { chartContainer.classList.toggle('show'); }
                });
            });
            document.querySelector('.target-recognition-container').style.display = 'none';
            document.querySelector('.profile-icon').addEventListener('click', function() {
                document.querySelector('.sidebar-collapsed').classList.toggle('sidebar-expanded');
                document.querySelector('.container').classList.toggle('container-expanded');
            });
            const loginPage = document.createElement('div');
            loginPage.className = 'login-page';
            loginPage.innerHTML = `<div class="login-form-container"><div class="auth-tabs"><button class="auth-tab active" data-tab="login">登录</button><button class="auth-tab" data-tab="register">注册</button></div><div id="login-form" class="auth-form active"><h2>用户登录</h2><input type="text" id="login-username" placeholder="用户名"><input type="password" id="login-password" placeholder="密码"><div class="login-options"><label class="remember-me"><input type="checkbox" id="remember-me"> 记住我</label><a href="#" class="forgot-password">忘记密码?</a></div><div class="login-buttons"><button id="login-submit" class="login-submit">登录</button><button id="login-cancel" class="login-cancel">取消</button></div></div><div id="register-form" class="auth-form"><h2>用户注册</h2><input type="text" id="register-username" placeholder="用户名"><input type="password" id="register-password" placeholder="密码"><input type="password" id="register-confirm" placeholder="确认密码"><div class="security-question"><select id="security-question"><option value="">选择安全问题</option></select></div><input type="text" id="security-answer" placeholder="安全问题答案"><div class="login-buttons"><button id="register-submit" class="login-submit">注册</button><button id="register-cancel" class="login-cancel">取消</button></div></div></div>`;
            document.body.appendChild(loginPage);
            const users = { 'admin': '******', 'user': '******' };
            initBatchProcessing();
        });

        function initBatchProcessing() {
            const recognitionModule = document.querySelector('.target-recognition-module h2');
            if (recognitionModule) {
                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'batch-mode-toggle';
                toggleBtn.textContent = '批量模式';
                toggleBtn.onclick = toggleBatchMode;
                recognitionModule.appendChild(toggleBtn);
            }
        }

        function toggleBatchMode() {
            batchMode = !batchMode;
            const toggleBtn = document.querySelector('.batch-mode-toggle');
            const uploadArea = document.getElementById('upload-area');
            if (batchMode) {
                toggleBtn.classList.add('active'); toggleBtn.textContent = '单张模式';
                if (!document.getElementById('batch-upload-container')) { createBatchUploadUI(); }
                uploadArea.style.display = 'none';
                document.getElementById('batch-upload-container').style.display = 'flex';
            } else {
                toggleBtn.classList.remove('active'); toggleBtn.textContent = '批量模式';
                uploadArea.style.display = 'flex';
                const batchContainer = document.getElementById('batch-upload-container');
                if (batchContainer) { batchContainer.style.display = 'none'; }
            }
        }

        function createBatchUploadUI() {
            const recognitionBox = document.querySelector('.recognition-box');
            const batchContainer = document.createElement('div');
            batchContainer.id = 'batch-upload-container';
            batchContainer.className = 'batch-upload-container';
            batchContainer.style.display = 'none';
            batchContainer.innerHTML = `<div style="width: 100%; height: 100%; display: flex; flex-direction: column;"><div class="upload-area" style="min-height: 150px;"><input type="file" id="batch-image-upload" accept="image/*" multiple style="display:none"><button id="batch-upload-button">选择多个图片</button><div class="batch-file-list" id="batch-file-list"></div></div><button id="batch-detect-button" class="detect-button" style="display:none;">批量检测</button><div class="batch-summary" id="batch-summary"><div class="batch-summary-stats"><div class="batch-stat-item"><div class="batch-stat-value" id="batch-total-images">0</div><div class="batch-stat-label">总图片</div></div><div class="batch-stat-item"><div class="batch-stat-value" id="batch-total-birds">0</div><div class="batch-stat-label">检测鸟类</div></div><div class="batch-stat-item"><div class="batch-stat-value" id="batch-avg-time">0</div><div class="batch-stat-label">平均用时(秒)</div></div></div><div class="batch-controls"><button class="batch-download-btn" onclick="downloadBatchResults()">下载结果</button><button class="batch-clear-btn" onclick="clearBatchResults()">清空</button></div></div><div class="batch-results-grid" id="batch-results-grid"></div><div class="batch-processing-overlay" id="batch-processing-overlay"><div class="batch-processing-content"><div class="batch-spinner"></div><div>正在处理...</div><div id="batch-progress">0 / 0</div></div></div></div>`;
            recognitionBox.appendChild(batchContainer);
            document.getElementById('batch-upload-button').addEventListener('click', () => { document.getElementById('batch-image-upload').click(); });
            document.getElementById('batch-image-upload').addEventListener('change', handleBatchFileSelect);
            document.getElementById('batch-detect-button').addEventListener('click', processBatchDetection);
        }

        function handleBatchFileSelect(event) {
            batchFiles = Array.from(event.target.files);
            const fileList = document.getElementById('batch-file-list');
            if (batchFiles.length > 0) {
                fileList.style.display = 'block';
                fileList.innerHTML = `<div style="color:#00b4ff;margin-bottom:5px;">已选择 ${batchFiles.length} 个文件:</div>`;
                batchFiles.forEach(file => {
                    const item = document.createElement('div');
                    item.className = 'batch-file-item';
                    item.textContent = file.name;
                    fileList.appendChild(item);
                });
                document.getElementById('batch-detect-button').style.display = 'block';
            }
        }

        async function processBatchDetection() {
            if (batchFiles.length === 0) return;
            const overlay = document.getElementById('batch-processing-overlay');
            overlay.classList.add('show');
            const formData = new FormData();
            batchFiles.forEach(file => { formData.append('images', file); });
            try {
                const response = await fetch('http://127.0.0.1:5050/api/batch_detect', { method: 'POST', body: formData });
                const data = await response.json();
                if (data.success) { displayBatchResults(data); } else { alert('批量检测失败: ' + data.error); }
            } catch (error) { alert('请求失败: ' + error.message); }
            finally { overlay.classList.remove('show'); }
        }

        function displayBatchResults(data) {
            batchResults = data.results;
            document.getElementById('batch-total-images').textContent = data.total_images;
            document.getElementById('batch-total-birds').textContent = data.total_birds;
            const avgTime = data.results.reduce((sum, r) => sum + (r.inference_time || 0), 0) / data.results.length;
            document.getElementById('batch-avg-time').textContent = avgTime.toFixed(2);
            document.getElementById('batch-summary').style.display = 'block';
            const grid = document.getElementById('batch-results-grid');
            grid.innerHTML = '';
            data.results.forEach(result => {
                if (result.success) {
                    const item = document.createElement('div');
                    item.className = 'batch-result-item';
                    item.innerHTML = `<img src="data:image/png;base64,${result.image}" alt="${result.filename}"><div class="batch-result-info"><div style="font-weight:bold;">${result.filename}</div><div>鸟类: ${result.count}</div></div>`;
                    grid.appendChild(item);
                }
            });
        }

        async function downloadBatchResults() {
            if (batchResults.length === 0) return;
            const response = await fetch('http://127.0.0.1:5050/api/download_results', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ images: batchResults.filter(r => r.success).map(r => ({ filename: 'result_' + r.filename, image: r.image })) }) });
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'bird_detection_results.zip'; a.click();
        }

        function clearBatchResults() {
            batchFiles = []; batchResults = [];
            document.getElementById('batch-file-list').innerHTML = '';
            document.getElementById('batch-file-list').style.display = 'none';
            document.getElementById('batch-results-grid').innerHTML = '';
            document.getElementById('batch-summary').style.display = 'none';
            document.getElementById('batch-detect-button').style.display = 'none';
        }
    </script>
</head>
<body>
<div class="auth-container">
    <div class="auth-status" id="auth-status">
        <span>未登录</span>
        <button id="login-btn" class="auth-btn">登录</button>
        <button id="register-btn" class="auth-btn">注册</button>
        <a href="simple_register.html" style="margin-left:10px;color:#1890ff;">[独立注册]</a>
    </div>
</div>
<h1>郑州黄河湿地空天地一体化智能监测平台</h1>
<div class="container">
    <div class="map-container" id="china-map" style="width: 100%; height: 600px;"></div>
    <div class="sidebar">
        <div class="module" id="real-time-monitor"><h2><span class="status-indicator"></span>实时监控</h2><p>系统运行状态实时监测</p><div class="chart-container" id="real-time-chart-container"><canvas id="real-time-chart"></canvas></div></div>
        <div class="module" id="temperature-monitor"><h2><span class="status-indicator"></span>温度监测</h2><p>环境温度数据可视化</p><div class="chart-container" id="temperature-chart-container"><canvas id="temperature-chart"></canvas></div></div>
        <div class="module" id="humidity-monitor"><h2><span class="status-indicator"></span>湿度监测</h2><p>环境湿度数据可视化</p><div class="chart-container" id="humidity-chart-container"><canvas id="humidity-chart"></canvas></div></div>
    </div>
    <div class="main-content">
        <div class="chart-container" id="distribution-chart-container"><canvas id="distribution-chart"></canvas></div>
        <div class="chart-container" id="precipitation-chart-container"><canvas id="precipitation-chart"></canvas></div>
    </div>
    <div class="sidebar">
        <div class="module" id="distribution-monitor"><h2><span class="status-indicator"></span>分布状况</h2><p>目标分布热力图展示</p><div class="chart-container" id="distribution-chart-container2"><canvas id="distribution-chart2"></canvas></div></div>
        <div class="module" id="precipitation-monitor"><h2><span class="status-indicator"></span>降水量</h2><p>目标分布降水量展示</p><div class="chart-container" id="precipitation-chart-container2"><canvas id="precipitation-chart2"></canvas></div></div>
    </div>
</div>
<div class="target-recognition-container" style="display:none;">
    <div class="target-recognition-module" id="target-recognition-module">
        <h2><span class="status-indicator"></span>目标识别</h2>
        <div class="recognition-box">
            <div class="upload-area" id="upload-area">
                <input type="file" id="image-upload" accept="image/*" style="display:none">
                <button id="upload-button">选择或拖放图片</button>
                <div class="preview-container" id="preview-container"></div>
                <button id="detect-button" class="detect-button" disabled>开始检测</button>
            </div>
            <div class="result-container" id="result-container">
                <div class="detection-image" id="detection-image"></div>
                <div class="detection-data" id="detection-data"></div>
            </div>
        </div>
    </div>
</div>
<script>
    document.addEventListener('DOMContentLoaded', function() {
        function createChart(canvasId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            return new Chart(ctx, { type: 'line', data: { labels: ['January', 'February', 'March', 'April', 'May', 'June', 'July'], datasets: [{ label: '数据曲线', data: [65, 59, 80, 81, 56, 55, 40], borderColor: '#00b4ff', borderWidth: 1 }] }, options: { responsive: true, plugins: { legend: { position: 'top' }, title: { display: true, text: '数据曲线图' } } } });
        }
        createChart('real-time-chart');
        createChart('temperature-chart');
        createChart('humidity-chart');
        createChart('distribution-chart');
        createChart('precipitation-chart');
        const uploadButton = document.getElementById('upload-button');
        const detectButton = document.getElementById('detect-button');
        const imageUpload = document.getElementById('image-upload');
        const previewContainer = document.getElementById('preview-container');
        const resultContainer = document.getElementById('result-container');
        const detectionData = document.getElementById('detection-data');
        const uploadArea = document.getElementById('upload-area');
        let currentFile = null;
        let isProcessing = false;
        function handleFile(file) {
            if (!file?.type.match('image.*')) { alert('请选择有效的图片文件'); return false; }
            if (isProcessing) return false;
            isProcessing = true;
            const reader = new FileReader();
            reader.onload = (event) => {
                previewContainer.innerHTML = `<img src="${event.target.result}" style="max-width:100%;max-height:200px;">`;
                previewContainer.style.display = 'block';
                uploadButton.textContent = '重新选择图片';
                detectButton.style.display = 'block';
                detectButton.disabled = false;
                currentFile = file;
                isProcessing = false;
            };
            reader.readAsDataURL(file);
            return true;
        }
        function processFileInput(files) { if (files && files[0]) { imageUpload.files = files; return handleFile(files[0]); } return false; }
        uploadButton.addEventListener('click', () => { imageUpload.value = ''; imageUpload.click(); });
        imageUpload.addEventListener('change', (e) => { processFileInput(e.target.files); });
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.border = '2px dashed #00b4ff'; });
        uploadArea.addEventListener('dragleave', () => { uploadArea.style.border = '2px dashed rgba(0,180,255,0.3)'; });
        uploadArea.addEventListener('drop', (e) => { e.preventDefault(); uploadArea.style.border = '2px dashed rgba(0,180,255,0.3)'; processFileInput(e.dataTransfer.files); });
        detectButton.addEventListener('click', async () => {
            if (!currentFile || isProcessing) return;
            isProcessing = true;
            detectButton.disabled = true;
            detectButton.textContent = '检测中...';
            resultContainer.style.display = 'flex';
            detectionData.innerHTML = '<div class="loading">检测中...</div>';
            try {
                const formData = new FormData();
                formData.append('image', currentFile);
                const response = await fetch('http://127.0.0.1:5050/api/detect', { method: 'POST', body: formData });
                const data = await response.json();
                if (data.status === 'success') {
                    const detectionImage = document.getElementById('detection-image');
                    detectionImage.innerHTML = `<img src="data:image/png;base64,${data.image}" style="max-width: 100%; height: auto;">`;
                    const result = JSON.parse(data.result);
                    detectionData.innerHTML = `<h3>检测结果</h3><p>检测数量: ${result.count}</p><p>推理时间: ${result.inference_time.toFixed(2)}秒</p><p>模型: ${result.model}</p><div class="detected-objects"><h4>检测到的目标:</h4>${result.objects.map(obj => `<div class="object-item"><span class="object-class">${obj.class}</span><span class="object-score">置信度: ${(obj.score * 100).toFixed(1)}%</span></div>`).join('')}</div>`;
                } else { detectionData.innerHTML = `<p style="color:#ff5555;">检测失败: ${data.message || '未知错误'}</p>`; }
            } catch (error) { detectionData.innerHTML = `<p style="color:#ff5555;">网络错误: ${error.message}</p>`; }
            finally { detectButton.disabled = false; detectButton.textContent = '开始检测'; isProcessing = false; }
        });
    });
</script>
</body>
</html>

# 文件名: visualheader/api_test.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>API测试页面</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .section { margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        button { padding: 10px 15px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
        button:hover { background-color: #45a049; }
        #imagePreview { max-width: 300px; margin-top: 10px; }
        #results { margin-top: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 4px; white-space: pre-wrap; }
        .loading { color: #666; font-style: italic; }
    </style>
</head>
<body>
    <h1>API测试页面</h1>
    <div class="section">
        <h2>目标检测测试</h2>
        <input type="file" id="imageUpload" accept="image/*">
        <div style="margin: 10px 0;">
            <label>选择模型: </label>
            <select id="modelSelect">
                <option value="detr-resnet-50">DETR-ResNet50 (快速)</option>
                <option value="detr-resnet-101">DETR-ResNet101 (标准)</option>
                <option value="detr-resnet-101-dc5" selected>DETR-ResNet101-DC5 (高精度)</option>
            </select>
        </div>
        <button onclick="testDetect()">测试目标检测</button>
        <div id="imagePreviewContainer"><img id="imagePreview" style="display:none;"></div>
        <div id="detectResults" class="loading">等待测试...</div>
    </div>
    <div class="section">
        <h2>地理数据测试</h2>
        <button onclick="testGeoData()">测试地理数据</button>
        <div id="geoResults" class="loading">等待测试...</div>
    </div>
    <script>
        let currentImage = null;
        document.getElementById('imageUpload').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                currentImage = file;
                const reader = new FileReader();
                reader.onload = function(event) {
                    const img = document.getElementById('imagePreview');
                    img.src = event.target.result; img.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        });
        async function testDetect() {
            if (!currentImage) { alert('请先选择图片'); return; }
            const resultsDiv = document.getElementById('detectResults');
            resultsDiv.innerHTML = '<span class="loading">检测中...</span>';
            try {
                const formData = new FormData();
                formData.append('image', currentImage);
                const model = document.getElementById('modelSelect').value;
                const response = await fetch(`http://127.0.0.1:8080/api/detect?model=${model}`, { method: 'POST', body: formData });
                if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) { throw new Error("Invalid response format"); }
                const data = await response.json().catch(e => { throw new Error(`JSON解析错误: ${e.message}`); });
                resultsDiv.innerHTML = `<div style="display: flex;"><div style="flex: 1;"><strong>检测结果:</strong><pre>${JSON.stringify(data, null, 2)}</pre></div><div style="flex: 1; margin-left: 20px;"><strong>结果图:</strong><img id="resultImage" style="max-width: 100%;" src="/api/result_image/${data.result_id}?t=${Date.now()}"></div></div>`;
            } catch (error) { resultsDiv.innerHTML = `<strong>错误:</strong> ${error.message}`; }
        }
        async function testGeoData() {
            const resultsDiv = document.getElementById('geoResults');
            resultsDiv.innerHTML = '<span class="loading">获取中...</span>';
            try {
                const response = await fetch('http://127.0.0.1:8080/api/geo');
                const data = await response.json();
                resultsDiv.innerHTML = `<strong>地理数据:</strong>\n${JSON.stringify(data, null, 2)}`;
            } catch (error) { resultsDiv.innerHTML = `<strong>错误:</strong> ${error.message}`; }
        }
    </script>
</body>
</html>

# 文件名: config.py
import os
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class DatabaseConfig:
    database_url: str = "visual_parts.db"
    pool_size: int = 5
    max_overflow: int = 10
    pool_timeout: int = 30

@dataclass
class ModelConfig:
    model_name: str = "facebook/detr-resnet-101-dc5"
    detection_threshold: float = 0.6
    nms_threshold: float = 0.5
    padding_ratio: float = 0.15
    contrast_enhance: float = 2.0
    sharpness_enhance: float = 1.5

@dataclass
class APIConfig:
    host: str = "0.0.0.0"
    port: int = 5050
    debug: bool = False
    cors_origins: List[str] = None
    def __post_init__(self):
        if self.cors_origins is None:
            self.cors_origins = ["*"]

@dataclass
class AuthConfig:
    security_questions: List[str] = None
    auth_port: int = 5000
    def __post_init__(self):
        if self.security_questions is None:
            self.security_questions = ["你的生日是什么时候？", "你母亲的名字是什么？", "你的第一所学校的名称是什么？", "你的宠物的名字是什么？", "你最喜欢的电影是什么？"]

@dataclass
class FrontendConfig:
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
    database: DatabaseConfig = DatabaseConfig()
    model: ModelConfig = ModelConfig()
    api: APIConfig = APIConfig()
    auth: AuthConfig = AuthConfig()
    frontend: FrontendConfig = FrontendConfig()
    
    @classmethod
    def from_env(cls):
        config = cls()
        if os.getenv('DATABASE_URL'):
            config.database.database_url = os.getenv('DATABASE_URL')
        if os.getenv('API_HOST'):
            config.api.host = os.getenv('API_HOST')
        if os.getenv('API_PORT'):
            config.api.port = int(os.getenv('API_PORT'))
        if os.getenv('API_DEBUG'):
            config.api.debug = os.getenv('API_DEBUG').lower() == 'true'
        if os.getenv('AUTH_PORT'):
            config.auth.auth_port = int(os.getenv('AUTH_PORT'))
        return config

config = Config.from_env()

# 文件名: dev-proxy.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;
app.use(cors());

app.options(/^\/api\/.*$/, (req, res) => res.sendStatus(200));

app.use('/api', createProxyMiddleware({
  target: 'http://127.0.0.1:8000',
  changeOrigin: true,
  logLevel: 'debug',
  cookieDomainRewrite: false,
  pathRewrite: (path) => {
    if (path.startsWith('/')) return '/api' + path;
    return '/api/' + path;
  },
  onProxyReq(proxyReq, req, res) {
    console.log('→ proxy', req.method, req.originalUrl, '=>', proxyReq.getHeader('host'), proxyReq.path);
  },
  onProxyRes(proxyRes, req, res) {
    console.log('← proxy', req.method, req.originalUrl, 'status', proxyRes.statusCode);
  }
}));

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => console.log(`Dev server running at http://localhost:${PORT}`));

# 文件名: visualheader/simple_register.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>注册 - 空天地一体化可视化平台</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
        .register-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 350px; }
        .register-container h2 { margin-top: 0; color: #333; text-align: center; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
        .form-group input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        .form-actions { display: flex; justify-content: space-between; margin-top: 20px; }
        .btn { padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #1890ff; color: white; }
        .btn-default { background: #f0f0f0; color: #333; }
    </style>
</head>
<body>
    <div class="register-container">
        <h2>用户注册</h2>
        <div class="form-group"><label for="username">用户名</label><input type="text" id="username" placeholder="请输入用户名"></div>
        <div class="form-group"><label for="password">密码</label><input type="password" id="password" placeholder="请输入密码"></div>
        <div class="form-group"><label for="confirm-password">确认密码</label><input type="password" id="confirm-password" placeholder="请再次输入密码"></div>
        <div class="form-actions"><button id="cancel-btn" class="btn btn-default">取消</button><button id="register-btn" class="btn btn-primary">注册</button></div>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const registerBtn = document.getElementById('register-btn');
            const cancelBtn = document.getElementById('cancel-btn');
            registerBtn.addEventListener('click', function() {
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                const confirmPassword = document.getElementById('confirm-password').value;
                if (!username || !password || !confirmPassword) { alert('请填写所有字段'); return; }
                if (password !== confirmPassword) { alert('两次输入的密码不一致'); return; }
                alert('注册成功(演示模式)');
            });
            cancelBtn.addEventListener('click', function() { window.history.back(); });
        });
    </script>
</body>
</html>

# 文件名: visualheader/province_template.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{{province}}科技地图</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #province-map { width: 100%; height: 80vh; }
        .back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100; }
        .province-info { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-radius: 8px; }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='tech_map.html'">← 返回全国</button>
    <div id="province-map"></div>
    <div class="province-info">
        <h2>{{province}}信息</h2>
        <p>面积：{{area}}平方公里</p>
        <p>人口：{{population}}万人</p>
        <p>GDP：{{gdp}}亿元</p>
    </div>
    <script>
        const mapChart = echarts.init(document.getElementById('province-map'));
        const provinceName = '{{province}}';
        $.get(`https://geo.datav.aliyun.com/areas_v3/bound/{{adcode}}_full.json`, function(geoJson) {
            echarts.registerMap(provinceName, geoJson);
            mapChart.setOption({
                backgroundColor: '#0f1621',
                title: { text: provinceName, left: 'center', textStyle: { color: '#fff' } },
                geo: { map: provinceName, roam: true, itemStyle: { areaColor: '#1a2b5a', borderColor: '#0a2dae' }, emphasis: { itemStyle: { areaColor: '#2a91d8' } } }
            });
        });
    </script>
</body>
</html>

# 文件名: visualheader/wetland.html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>郑州黄河湿地自然保护区</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
        #map-container { width: 100%; height: 85vh; }
        .info-panel { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-radius: 8px; }
        .back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100; }
    </style>
</head>
<body>
    <button class="back-button" onclick="window.location.href='henan.html'">← 返回河南省</button>
    <div id="map-container"></div>
    <div class="info-panel">
        <h2>郑州黄河湿地自然保护区</h2>
        <p>位置：河南省郑州市</p>
        <p>面积：约36000公顷</p>
        <p>特点：国家重要湿地,鸟类迁徙重要通道</p>
    </div>
    <script>
        const mapChart = echarts.init(document.getElementById('map-container'));
        const mapOption = {
            backgroundColor: '#0f1621',
            title: { text: '郑州黄河湿地自然保护区', left: 'center', textStyle: { color: '#fff' } },
            geo: { map: 'henan', roam: true, itemStyle: { areaColor: '#1a2b5a', borderColor: '#0a2dae' }, emphasis: { itemStyle: { areaColor: '#2a91d8' } } }
        };
        $.get('https://geo.datav.aliyun.com/areas_v3/bound/410000_full.json', function(geoJson) {
            echarts.registerMap('henan', geoJson);
            mapChart.setOption(mapOption);
        });
    </script>
</body>
</html>

# 文件名: Backend/betest.py
from database import Database
import requests

def test():
    db = Database()
    if db.verify_user('admin', '******'):
        print('登录成功')
    else:
        print('登录失败')

test()
