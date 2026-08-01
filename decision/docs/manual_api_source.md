# 空天地一体化智能监测平台源代码

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
print(&quot;正在加载模型...&quot;)
processor = DetrImageProcessor.from_pretrained(&quot;facebook/detr-resnet-101-dc5&quot;)
model = DetrForObjectDetection.from_pretrained(&quot;facebook/detr-resnet-101-dc5&quot;)
device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
model.to(device)
print(f&quot;使用设备: {device.type.upper()}&quot;)
try:
font = ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
except IOError:
try:
font = ImageFont.truetype(&quot;simsun.ttc&quot;, 20)
except IOError:
font = ImageFont.load_default()
print(&quot;警告: 无法加载中文字体，将使用默认字体&quot;)
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
while order.numel() &gt; 0:
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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
def crop_to_roi(image, padding=0.15):
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):
if edges.getpixel((x, y)) &gt; 100:
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
def process_single_image(image, filename=&quot;&quot;):
try:
enhancer = ImageEnhance.Contrast(image)
image = enhancer.enhance(2.0)
enhancer = ImageEnhance.Sharpness(image)
image = enhancer.enhance(1.5)
image = image.filter(ImageFilter.MedianFilter(size=3))
roi_image, crop_offset = crop_to_roi(image)
inputs = processor(images=roi_image, return_tensors=&quot;pt&quot;).to(device)
start_time = time.time()
with torch.no_grad():
outputs = model(**inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
results = processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=0.6
)[0]
boxes = results[&quot;boxes&quot;].cpu()
scores = results[&quot;scores&quot;].cpu()
labels = results[&quot;labels&quot;].cpu()
keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
boxes = boxes[keep_indices]
scores = scores[keep_indices]
labels = labels[keep_indices]
bird_indices = []
for i, label in enumerate(labels):
class_name = model.config.id2label[label.item()].lower()
if &quot;bird&quot; in class_name:
bird_indices.append(i)
if bird_indices:
bird_indices = torch.tensor(bird_indices, dtype=torch.long)
results[&quot;boxes&quot;] = boxes[bird_indices]
results[&quot;scores&quot;] = scores[bird_indices]
results[&quot;labels&quot;] = labels[bird_indices]
if len(results[&quot;boxes&quot;]) &gt; 0:
results[&quot;boxes&quot;][:, 0] += crop_offset[0]
results[&quot;boxes&quot;][:, 1] += crop_offset[1]
results[&quot;boxes&quot;][:, 2] += crop_offset[0]
results[&quot;boxes&quot;][:, 3] += crop_offset[1]
else:
results[&quot;boxes&quot;] = torch.tensor([])
results[&quot;scores&quot;] = torch.tensor([])
results[&quot;labels&quot;] = torch.tensor([])
draw = ImageDraw.Draw(image)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: DETR-ResNet101-DC5&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=font)
detected_objects = []
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = model.config.id2label[label.item()]
color = colors[i % len(colors)]
detected_objects.append({
&quot;class&quot;: class_name,
&quot;score&quot;: float(score),
&quot;box&quot;: box
})
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=font)
buffer = io.BytesIO()
image.save(buffer, format=&#39;PNG&#39;)
img_str = base64.b64encode(buffer.getvalue()).decode()
return {
&quot;success&quot;: True,
&quot;filename&quot;: filename,
&quot;image&quot;: img_str,
&quot;count&quot;: object_count,
&quot;inference_time&quot;: infer_time,
&quot;objects&quot;: detected_objects
}
except Exception as e:
return {
&quot;success&quot;: False,
&quot;filename&quot;: filename,
&quot;error&quot;: str(e)
}
@app.route(&#39;/api/batch_detect&#39;, methods=[&#39;POST&#39;])
def batch_detect():
try:
if &#39;images&#39; not in request.files:
return jsonify({&quot;success&quot;: False, &quot;error&quot;: &quot;没有上传图片&quot;}), 400
files = request.files.getlist(&#39;images&#39;)
results = []
for file in files:
if file and file.filename:
image = Image.open(file.stream)
result = process_single_image(image, file.filename)
results.append(result)
total_count = sum(r[&#39;count&#39;] for r in results if r[&#39;success&#39;])
successful = sum(1 for r in results if r[&#39;success&#39;])
return jsonify({
&quot;success&quot;: True,
&quot;total_images&quot;: len(files),
&quot;successful&quot;: successful,
&quot;total_birds&quot;: total_count,
&quot;results&quot;: results
})
except Exception as e:
return jsonify({&quot;success&quot;: False, &quot;error&quot;: str(e)}), 500
@app.route(&#39;/api/detect&#39;, methods=[&#39;POST&#39;])
def detect():
try:
if &#39;image&#39; not in request.files:
return jsonify({&quot;success&quot;: False, &quot;error&quot;: &quot;没有上传图片&quot;}), 400
file = request.files[&#39;image&#39;]
if file.filename == &#39;&#39;:
return jsonify({&quot;success&quot;: False, &quot;error&quot;: &quot;文件名为空&quot;}), 400
image = Image.open(file.stream)
result = process_single_image(image, file.filename)
if result[&#39;success&#39;]:
return jsonify({
&quot;status&quot;: &quot;success&quot;,
&quot;message&quot;: f&quot;检测完成，发现 {result[&#39;count&#39;]} 只鸟类&quot;,
&quot;image&quot;: result[&#39;image&#39;],
&quot;result&quot;: json.dumps({
&quot;count&quot;: result[&#39;count&#39;],
&quot;inference_time&quot;: result[&#39;inference_time&#39;],
&quot;model&quot;: &quot;DETR-ResNet101-DC5&quot;,
&quot;objects&quot;: result[&#39;objects&#39;]
})
})
else:
return jsonify({
&quot;status&quot;: &quot;error&quot;,
&quot;message&quot;: result[&#39;error&#39;]
}), 500
except Exception as e:
return jsonify({&quot;status&quot;: &quot;error&quot;, &quot;message&quot;: str(e)}), 500
@app.route(&#39;/api/download_results&#39;, methods=[&#39;POST&#39;])
def download_results():
try:
data = request.json
images = data.get(&#39;images&#39;, [])
temp_dir = tempfile.mkdtemp()
for i, img_data in enumerate(images):
img_bytes = base64.b64decode(img_data[&#39;image&#39;])
filename = img_data.get(&#39;filename&#39;, f&#39;result_{i}.png&#39;)
filepath = os.path.join(temp_dir, filename)
with open(filepath, &#39;wb&#39;) as f:
f.write(img_bytes)
zip_path = os.path.join(temp_dir, &#39;results.zip&#39;)
with zipfile.ZipFile(zip_path, &#39;w&#39;) as zipf:
for root, dirs, files in os.walk(temp_dir):
for file in files:
if file != &#39;results.zip&#39;:
zipf.write(os.path.join(root, file), file)
return send_file(zip_path, as_attachment=True, download_name=&#39;bird_detection_results.zip&#39;)
except Exception as e:
return jsonify({&quot;success&quot;: False, &quot;error&quot;: str(e)}), 500
finally:
if &#39;temp_dir&#39; in locals():
shutil.rmtree(temp_dir, ignore_errors=True)
if __name__ == &#39;__main__&#39;:
init_model()
app.run(host=&#39;0.0.0.0&#39;, port=5050, debug=False)

# 文件名: Backend/auth_api.py
from flask import Flask, request, jsonify
from database import Database
import json
app = Flask(__name__)
db = Database()
SECURITY_QUESTIONS = [
&quot;你的生日是什么时候？&quot;,
&quot;你母亲的名字是什么？&quot;,
&quot;你的第一所学校的名称是什么？&quot;,
&quot;你的宠物的名字是什么？&quot;,
&quot;你最喜欢的电影是什么？&quot;
]
@app.route(&#39;/api/register&#39;, methods=[&#39;POST&#39;])
def register():
data = request.get_json()
username = data.get(&#39;username&#39;)
password = data.get(&#39;password&#39;)
question = data.get(&#39;question&#39;)
answer = data.get(&#39;answer&#39;)
if not all([username, password, question, answer]):
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;缺少必要参数&#39;}), 400
if question not in SECURITY_QUESTIONS:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;无效的安全问题&#39;}), 400
if db.register_user(username, password, question, answer):
return jsonify({&#39;success&#39;: True})
else:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;用户名已存在&#39;}), 400
@app.route(&#39;/api/login&#39;, methods=[&#39;POST&#39;])
def login():
data = request.get_json()
username = data.get(&#39;username&#39;)
password = data.get(&#39;password&#39;)
if not all([username, password]):
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;缺少用户名或密码&#39;}), 400
if db.verify_user(username, password):
return jsonify({&#39;success&#39;: True})
else:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;用户名或密码错误&#39;}), 401
@app.route(&#39;/&#39;)
def index():
return jsonify({&#39;status&#39;: &#39;running&#39;, &#39;service&#39;: &#39;auth_api&#39;})
@app.route(&#39;/health&#39;)
def health_check():
return jsonify({&#39;status&#39;: &#39;healthy&#39;})
@app.route(&#39;/api/security-questions&#39;, methods=[&#39;GET&#39;])
def get_security_questions():
return jsonify({&#39;questions&#39;: SECURITY_QUESTIONS})
@app.route(&#39;/api/forgot-password&#39;, methods=[&#39;POST&#39;])
def forgot_password():
data = request.get_json()
username = data.get(&#39;username&#39;)
if not username:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;请输入用户名&#39;}), 400
question = db.get_security_question(username)
if not question:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;用户不存在&#39;}), 404
return jsonify({&#39;success&#39;: True, &#39;question&#39;: question})
@app.route(&#39;/api/reset-password&#39;, methods=[&#39;POST&#39;])

def reset_password():
data = request.get_json()
username = data.get(&#39;username&#39;)
answer = data.get(&#39;answer&#39;)
new_password = data.get(&#39;newPassword&#39;)
if not all([username, answer, new_password]):
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;缺少必要参数&#39;}), 400
if not db.verify_security_answer(username, answer):
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;安全问题答案错误&#39;}), 401
if db.reset_password(username, new_password):
return jsonify({&#39;success&#39;: True})
else:
return jsonify({&#39;success&#39;: False, &#39;message&#39;: &#39;密码重置失败&#39;}), 500
if __name__ == &#39;__main__&#39;:
app.run(host=&#39;0.0.0.0&#39;, port=5000, debug=True)

# 文件名: Backend/database.py
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
def init_db():
conn = sqlite3.connect(&#39;visual_parts.db&#39;)
cursor = conn.cursor()
cursor.execute(&#39;&#39;&#39;
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
security_question TEXT NOT NULL,
security_answer TEXT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
&#39;&#39;&#39;)
cursor.execute(&#39;&#39;&#39;
CREATE TABLE IF NOT EXISTS geo_data (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
data_type TEXT NOT NULL,
coordinates TEXT NOT NULL,
properties TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (user_id) REFERENCES users (id)
)
&#39;&#39;&#39;)
conn.commit()
conn.close()
class Database:
def __init__(self):
self.conn = sqlite3.connect(&#39;visual_parts.db&#39;)
self.cursor = self.conn.cursor()
def register_user(self, username, password, question, answer):
try:
self.cursor.execute(
&#39;INSERT INTO users (username, password_hash, security_question, security_answer)
VALUES (?, ?, ?, ?)&#39;,
(username, generate_password_hash(password), question, answer)
)
self.conn.commit()
return True
except sqlite3.IntegrityError:
return False

def verify_user(self, username, password):
self.cursor.execute(
&#39;SELECT password_hash FROM users WHERE username = ?&#39;,
(username,)
)
result = self.cursor.fetchone()
if result and check_password_hash(result[0], password):
return True
return False
def get_security_question(self, username):
self.cursor.execute(
&#39;SELECT security_question FROM users WHERE username = ?&#39;,
(username,)
)
result = self.cursor.fetchone()
return result[0] if result else None
def verify_security_answer(self, username, answer):
self.cursor.execute(
&#39;SELECT security_answer FROM users WHERE username = ?&#39;,
(username,)
)
result = self.cursor.fetchone()
return result and result[0] == answer
def reset_password(self, username, new_password):
self.cursor.execute(
&#39;UPDATE users SET password_hash = ? WHERE username = ?&#39;,
(generate_password_hash(new_password), username)
)
self.conn.commit()
return self.cursor.rowcount &gt; 0
def add_geo_data(self, user_id, data_type, coordinates, properties=None):
self.cursor.execute(
&#39;INSERT INTO geo_data (user_id, data_type, coordinates, properties) VALUES (?, ?, ?,
?)&#39;,
(user_id, data_type, coordinates, properties)
)
self.conn.commit()
return self.cursor.lastrowid
def get_user_id(self, username):
self.cursor.execute(
&#39;SELECT id FROM users WHERE username = ?&#39;,
(username,)
)
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
self.colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
@staticmethod
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
while order.numel() &gt; 0:
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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
@staticmethod
def crop_to_roi(image: Image.Image, padding: float = 0.15) -&gt; Tuple[Image.Image, Tuple[int,
int]]:
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):

if edges.getpixel((x, y)) &gt; 100:
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
def enhance_image(self, image: Image.Image) -&gt; Image.Image:
enhancer = ImageEnhance.Contrast(image)
image = enhancer.enhance(config.model.contrast_enhance)
enhancer = ImageEnhance.Sharpness(image)
image = enhancer.enhance(config.model.sharpness_enhance)
image = image.filter(ImageFilter.MedianFilter(size=3))
return image
def detect_birds(self, image: Image.Image) -&gt; Dict:
try:
enhanced_image = self.enhance_image(image)
roi_image, crop_offset = self.crop_to_roi(enhanced_image, config.model.padding_ratio)
inputs = self.processor(images=roi_image, return_tensors=&quot;pt&quot;).to(self.device)
start_time = time.time()
with torch.no_grad():
outputs = self.model(**inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
results = self.processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
)[0]
boxes = results[&quot;boxes&quot;].cpu()
scores = results[&quot;scores&quot;].cpu()
labels = results[&quot;labels&quot;].cpu()
keep_indices = self.non_max_suppression(boxes, scores, config.model.nms_threshold)
boxes = boxes[keep_indices]
scores = scores[keep_indices]
labels = labels[keep_indices]
bird_indices = []
for i, label in enumerate(labels):
class_name = self.model.config.id2label[label.item()].lower()
if &quot;bird&quot; in class_name:
bird_indices.append(i)
if bird_indices:
bird_indices = torch.tensor(bird_indices, dtype=torch.long)
results[&quot;boxes&quot;] = boxes[bird_indices]
results[&quot;scores&quot;] = scores[bird_indices]
results[&quot;labels&quot;] = labels[bird_indices]
if len(results[&quot;boxes&quot;]) &gt; 0:
results[&quot;boxes&quot;][:, 0] += crop_offset[0]
results[&quot;boxes&quot;][:, 1] += crop_offset[1]


results[&quot;boxes&quot;][:, 2] += crop_offset[0]
results[&quot;boxes&quot;][:, 3] += crop_offset[1]
else:
results[&quot;boxes&quot;] = torch.tensor([])
results[&quot;scores&quot;] = torch.tensor([])
results[&quot;labels&quot;] = torch.tensor([])
return {
&quot;results&quot;: results,
&quot;inference_time&quot;: infer_time,
&quot;original_image&quot;: image,
&quot;crop_offset&quot;: crop_offset
}
except Exception as e:
raise Exception(f&quot;鸟类检测失败: {str(e)}&quot;)
def draw_detection_results(self, detection_result: Dict) -&gt; Image.Image:
image = detection_result[&quot;original_image&quot;]
results = detection_result[&quot;results&quot;]
infer_time = detection_result[&quot;inference_time&quot;]
draw = ImageDraw.Draw(image)
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: DETR-ResNet101-DC5&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=self.font)
detected_objects = []
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = self.model.config.id2label[label.item()]
color = self.colors[i % len(self.colors)]
detected_objects.append({
&quot;class&quot;: class_name,
&quot;score&quot;: float(score),
&quot;box&quot;: box
})
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=self.font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=self.font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=self.font)
return image, detected_objects, object_count
def image_to_base64(self, image: Image.Image) -&gt; str:
buffer = io.BytesIO()
image.save(buffer, format=&#39;PNG&#39;)
return base64.b64encode(buffer.getvalue()).decode()
def process_single_image(self, image: Image.Image, filename: str = &quot;&quot;) -&gt; Dict:
try:
detection_result = self.detect_birds(image)
result_image, detected_objects, object_count =

self.draw_detection_results(detection_result)
img_str = self.image_to_base64(result_image)
return {
&quot;success&quot;: True,
&quot;filename&quot;: filename,
&quot;image&quot;: img_str,
&quot;count&quot;: object_count,
&quot;inference_time&quot;: detection_result[&quot;inference_time&quot;],
&quot;objects&quot;: detected_objects
}
except Exception as e:
return {
&quot;success&quot;: False,
&quot;filename&quot;: filename,
&quot;error&quot;: str(e)
}
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
print(&quot;正在加载模型...&quot;)
self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
self.device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
self.model.to(self.device)
print(f&quot;使用设备: {self.device.type.upper()}&quot;)
self._load_font()
self.is_initialized = True
print(&quot;模型加载完成&quot;)
except Exception as e:
print(f&quot;模型初始化失败: {e}&quot;)
raise
def _load_font(self):
try:
self.font = ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
except IOError:
try:
self.font = ImageFont.truetype(&quot;simsun.ttc&quot;, 20)
except IOError:
self.font = ImageFont.load_default()

print(&quot;警告: 无法加载中文字体，将使用默认字体&quot;)
def non_max_suppression(self, boxes, scores, threshold=0.5):
if boxes.numel() == 0:
return torch.empty((0,), dtype=torch.long)
x1 = boxes[:, 0]
y1 = boxes[:, 1]
x2 = boxes[:, 2]
y2 = boxes[:, 3]
areas = (x2 - x1 + 1) * (y2 - y1 + 1)
order = scores.argsort(descending=True)
keep = []
while order.numel() &gt; 0:
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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
def crop_to_roi(self, image, padding=0.15):
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):
if edges.getpixel((x, y)) &gt; 100:
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
def detect_birds(self, image, filename=&quot;&quot;):
if not self.is_initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
try:
processed_image = self.preprocess_image(image)
roi_image, crop_offset = self.crop_to_roi(processed_image, config.model.padding_ratio)
inputs = self.processor(images=roi_image, return_tensors=&quot;pt&quot;).to(self.device)
start_time = time.time()
with torch.no_grad():
outputs = self.model(**inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
results = self.processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
)[0]
boxes = results[&quot;boxes&quot;].cpu()
scores = results[&quot;scores&quot;].cpu()
labels = results[&quot;labels&quot;].cpu()
keep_indices = self.non_max_suppression(boxes, scores, config.model.nms_threshold)
boxes = boxes[keep_indices]
scores = scores[keep_indices]
labels = labels[keep_indices]
bird_indices = []
for i, label in enumerate(labels):
class_name = self.model.config.id2label[label.item()].lower()
if &quot;bird&quot; in class_name:
bird_indices.append(i)
if bird_indices:
bird_indices = torch.tensor(bird_indices, dtype=torch.long)
results[&quot;boxes&quot;] = boxes[bird_indices]
results[&quot;scores&quot;] = scores[bird_indices]
results[&quot;labels&quot;] = labels[bird_indices]
if len(results[&quot;boxes&quot;]) &gt; 0:
results[&quot;boxes&quot;][:, 0] += crop_offset[0]
results[&quot;boxes&quot;][:, 1] += crop_offset[1]
results[&quot;boxes&quot;][:, 2] += crop_offset[0]
results[&quot;boxes&quot;][:, 3] += crop_offset[1]
else:
results[&quot;boxes&quot;] = torch.tensor([])
results[&quot;scores&quot;] = torch.tensor([])
results[&quot;labels&quot;] = torch.tensor([])
return {
&quot;results&quot;: results,
&quot;inference_time&quot;: infer_time,
&quot;original_image&quot;: image,
&quot;crop_offset&quot;: crop_offset
}
except Exception as e:
raise RuntimeError(f&quot;检测失败: {e}&quot;)
def visualize_results(self, detection_result, filename=&quot;&quot;):
image = detection_result[&quot;original_image&quot;]
results = detection_result[&quot;results&quot;]
infer_time = detection_result[&quot;inference_time&quot;]
draw = ImageDraw.Draw(image)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: {config.model.model_name}&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=self.font)
detected_objects = []
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = self.model.config.id2label[label.item()]
color = colors[i % len(colors)]
detected_objects.append({
&quot;class&quot;: class_name,
&quot;score&quot;: float(score),
&quot;box&quot;: box
})
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=self.font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=self.font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=self.font)
buffer = io.BytesIO()
image.save(buffer, format=&#39;PNG&#39;)
img_str = base64.b64encode(buffer.getvalue()).decode()
return {
&quot;image&quot;: img_str,
&quot;count&quot;: object_count,
&quot;objects&quot;: detected_objects,
&quot;inference_time&quot;: infer_time
}
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
logger.info(&quot;正在加载模型...&quot;)
self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
self.device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
self.model.to(self.device)
logger.info(f&quot;使用设备: {self.device.type.upper()}&quot;)
self._load_font()
self._initialized = True
logger.info(&quot;模型加载完成&quot;)
return True
except Exception as e:
logger.error(f&quot;模型初始化失败: {e}&quot;)
self._initialized = False
return False
def _load_font(self):
try:
self.font = ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
except IOError:
try:
self.font = ImageFont.truetype(&quot;simsun.ttc&quot;, 20)
except IOError:
self.font = ImageFont.load_default()
logger.warning(&quot;无法加载中文字体，将使用默认字体&quot;)
def non_max_suppression(self, boxes, scores, threshold=config.model.nms_threshold):
if boxes.numel() == 0:
return torch.empty((0,), dtype=torch.long)
x1 = boxes[:, 0]
y1 = boxes[:, 1]
x2 = boxes[:, 2]
y2 = boxes[:, 3]
areas = (x2 - x1 + 1) * (y2 - y1 + 1)
order = scores.argsort(descending=True)
keep = []
while order.numel() &gt; 0:
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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
def crop_to_roi(self, image, padding=config.model.padding_ratio):
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):
if edges.getpixel((x, y)) &gt; 100:
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
def detect_birds(self, image, filename=&quot;&quot;):
if not self._initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
try:
processed_image = self.preprocess_image(image)
roi_image, crop_offset = self.crop_to_roi(processed_image)
inputs = self.processor(images=roi_image, return_tensors=&quot;pt&quot;).to(self.device)
start_time = time.time()
with torch.no_grad():
outputs = self.model(**inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(self.device)
results = self.processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
)[0]
boxes = results[&quot;boxes&quot;].cpu()
scores = results[&quot;scores&quot;].cpu()
labels = results[&quot;labels&quot;].cpu()
keep_indices = self.non_max_suppression(boxes, scores)
boxes = boxes[keep_indices]
scores = scores[keep_indices]
labels = labels[keep_indices]
bird_indices = []
for i, label in enumerate(labels):
class_name = self.model.config.id2label[label.item()].lower()
if &quot;bird&quot; in class_name:
bird_indices.append(i)
if bird_indices:
bird_indices = torch.tensor(bird_indices, dtype=torch.long)
results[&quot;boxes&quot;] = boxes[bird_indices]
results[&quot;scores&quot;] = scores[bird_indices]
results[&quot;labels&quot;] = labels[bird_indices]
if len(results[&quot;boxes&quot;]) &gt; 0:
results[&quot;boxes&quot;][:, 0] += crop_offset[0]
results[&quot;boxes&quot;][:, 1] += crop_offset[1]
results[&quot;boxes&quot;][:, 2] += crop_offset[0]
results[&quot;boxes&quot;][:, 3] += crop_offset[1]
else:
results[&quot;boxes&quot;] = torch.tensor([])
results[&quot;scores&quot;] = torch.tensor([])
results[&quot;labels&quot;] = torch.tensor([])
return {
&quot;results&quot;: results,
&quot;inference_time&quot;: infer_time,
&quot;crop_offset&quot;: crop_offset,
&quot;original_image&quot;: image
}
except Exception as e:
logger.error(f&quot;鸟类检测失败: {e}&quot;)
raise
def visualize_results(self, detection_result):
image = detection_result[&quot;original_image&quot;]
results = detection_result[&quot;results&quot;]
infer_time = detection_result[&quot;inference_time&quot;]
draw = ImageDraw.Draw(image)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: {config.model.model_name}&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=self.font)
detected_objects = []
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = self.model.config.id2label[label.item()]
color = colors[i % len(colors)]
detected_objects.append({
&quot;class&quot;: class_name,
&quot;score&quot;: float(score),
&quot;box&quot;: box
})
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=self.font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=self.font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=self.font)
return image, detected_objects, object_count
model_service = ModelService()
# 文件名: utils/__init__.py
from .image_processor import ImageProcessor
from .model_manager import ModelManager
from .logger import setup_logger
from .error_handler import APIError, handle_api_error
__all__ = [&#39;ImageProcessor&#39;, &#39;ModelManager&#39;, &#39;setup_logger&#39;, &#39;APIError&#39;, &#39;handle_api_error&#39;]
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
def _load_font(self) -&gt; ImageFont.FreeTypeFont:
try:
return ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
except IOError:
try:
return ImageFont.truetype(&quot;simsun.ttc&quot;, 20)
except IOError:
font = ImageFont.load_default()
print(&quot;警告: 无法加载中文字体，将使用默认字体&quot;)
return font
def non_max_suppression(self, boxes: torch.Tensor, scores: torch.Tensor, threshold: float = 0.5)
-&gt; torch.Tensor:
if boxes.numel() == 0:
return torch.empty((0,), dtype=torch.long)
x1 = boxes[:, 0]
y1 = boxes[:, 1]
x2 = boxes[:, 2]
y2 = boxes[:, 3]
areas = (x2 - x1 + 1) * (y2 - y1 + 1)
order = scores.argsort(descending=True)
keep = []
while order.numel() &gt; 0:
if order.numel() == 1:
i = order.item()
keep.append(i)
Break

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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
def crop_to_roi(self, image: Image.Image, padding: float = None) -&gt; Tuple[Image.Image,
Tuple[int, int]]:
if padding is None:
padding = self.config.padding_ratio
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):
if edges.getpixel((x, y)) &gt; 100:
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
def enhance_image(self, image: Image.Image) -&gt; Image.Image:
enhancer = ImageEnhance.Contrast(image)
image = enhancer.enhance(self.config.contrast_enhance)
enhancer = ImageEnhance.Sharpness(image)
image = enhancer.enhance(self.config.sharpness_enhance)
image = image.filter(ImageFilter.MedianFilter(size=3))
return image
def draw_detection_results(self, image: Image.Image, results: Dict, crop_offset: Tuple[int, int],
infer_time: float) -&gt; Tuple[Image.Image, List[Dict]]:
draw = ImageDraw.Draw(image)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: DETR-ResNet101-DC5&quot;, fill=&quot;white&quot;, font=self.font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=self.font)

draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=self.font)
detected_objects = []
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = results[&quot;class_names&quot;][i]
color = colors[i % len(colors)]
detected_objects.append({
&quot;class&quot;: class_name,
&quot;score&quot;: float(score),
&quot;box&quot;: box
})
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=self.font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=self.font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=self.font)
return image, detected_objects
def image_to_base64(self, image: Image.Image) -&gt; str:
buffer = io.BytesIO()
image.save(buffer, format=&#39;PNG&#39;)
return base64.b64encode(buffer.getvalue()).decode()
# 文件名: utils/logger.py
import logging
import os
from datetime import datetime
from typing import Optional
def setup_logger(
name: str = &quot;visual_parts&quot;,
level: int = logging.INFO,
log_file: Optional[str] = None,
format_string: Optional[str] = None
) -&gt; logging.Logger:
if format_string is None:
format_string = &#39;%(asctime)s - %(name)s - %(levelname)s - %(message)s&#39;
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
file_handler = logging.FileHandler(log_file, encoding=&#39;utf-8&#39;)

file_handler.setLevel(level)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)
return logger
def get_api_logger() -&gt; logging.Logger:
return setup_logger(
name=&quot;visual_parts.api&quot;,
log_file=&quot;logs/api.log&quot;
)
def get_auth_logger() -&gt; logging.Logger:
return setup_logger(
name=&quot;visual_parts.auth&quot;,
log_file=&quot;logs/auth.log&quot;
)
def get_detection_logger() -&gt; logging.Logger:
return setup_logger(
name=&quot;visual_parts.detection&quot;,
log_file=&quot;logs/detection.log&quot;
)
def log_api_request(logger: logging.Logger, endpoint: str, method: str,
status_code: int, processing_time: float, user_agent: str = None):
logger.info(
f&quot;API Request - {method} {endpoint} - Status: {status_code} - &quot;
f&quot;Time: {processing_time:.3f}s - UserAgent: {user_agent or &#39;Unknown&#39;}&quot;
)
def log_detection_result(logger: logging.Logger, filename: str, count: int,
inference_time: float, success: bool = True):
status = &quot;成功&quot; if success else &quot;失败&quot;
logger.info(
f&quot;Detection Result - 文件: {filename} - 检测数量: {count} - &quot;
f&quot;推理时间: {inference_time:.3f}s - 状态: {status}&quot;
)
def log_error(logger: logging.Logger, error_type: str, error_message: str,
stack_trace: str = None):
logger.error(
f&quot;Error - 类型: {error_type} - 消息: {error_message}&quot;
)
if stack_trace:
logger.debug(f&quot;Stack Trace: {stack_trace}&quot;)
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
def initialize_model(self) -&gt; bool:
try:
print(&quot;正在加载模型...&quot;)
self.processor = DetrImageProcessor.from_pretrained(config.model.model_name)
self.model = DetrForObjectDetection.from_pretrained(config.model.model_name)
self.device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
self.model.to(self.device)
print(f&quot;使用设备: {self.device.type.upper()}&quot;)
self.is_initialized = True
return True
except Exception as e:
print(f&quot;模型加载失败: {e}&quot;)
self.is_initialized = False
return False
def preprocess_image(self, image) -&gt; Dict[str, torch.Tensor]:
if not self.is_initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
return self.processor(images=image, return_tensors=&quot;pt&quot;).to(self.device)
def inference(self, inputs: Dict[str, torch.Tensor]) -&gt; Dict[str, Any]:
if not self.is_initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
start_time = time.time()
with torch.no_grad():
outputs = self.model(**inputs)
infer_time = time.time() - start_time
return {
&quot;outputs&quot;: outputs,
&quot;inference_time&quot;: infer_time
}
def post_process(self, outputs, target_sizes) -&gt; Dict[str, torch.Tensor]:
if not self.is_initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
results = self.processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=config.model.detection_threshold
)[0]
return results
def get_model_config(self):
if not self.is_initialized:
raise RuntimeError(&quot;模型未初始化&quot;)
return self.model.config
def is_ready(self) -&gt; bool:
return self.is_initialized
def get_device_info(self) -&gt; str:
if self.device:
return f&quot;{self.device.type.upper()}&quot;
return &quot;未初始化&quot;

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
UPLOAD_FOLDER = &#39;identification/result&#39;
ALLOWED_EXTENSIONS = {&#39;png&#39;, &#39;jpg&#39;, &#39;jpeg&#39;}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
def allowed_file(filename):
return &#39;.&#39; in filename and \
filename.rsplit(&#39;.&#39;, 1)[1].lower() in ALLOWED_EXTENSIONS
@app.route(&#39;/api/detect&#39;, methods=[&#39;POST&#39;])
def detect():
if &#39;image&#39; not in request.files:
return jsonify({&#39;error&#39;: &#39;No image file provided&#39;}), 400
image_file = request.files[&#39;image&#39;]
if image_file.filename == &#39;&#39;:
return jsonify({&#39;error&#39;: &#39;No selected file&#39;}), 400
if not allowed_file(image_file.filename):
return jsonify({&#39;error&#39;: &#39;Invalid file type&#39;}), 400
try:
image_data = image_file.read()
timestamp = datetime.now().strftime(&quot;%Y%m%d_%H%M%S&quot;)
unique_id = str(uuid.uuid4())[:8]
filename = f&quot;detection_{timestamp}_{unique_id}.jpg&quot;
save_path = os.path.join(UPLOAD_FOLDER, filename)
result_json = detect_objects(image_data, return_type=&#39;json&#39;)
result_image = detect_objects(image_data, return_type=&#39;image&#39;)
with open(save_path, &#39;wb&#39;) as f:
f.write(base64.b64decode(result_image))
response = {
&#39;success&#39;: True,
&#39;result&#39;: result_json,
&#39;image_path&#39;: save_path,
&#39;image_url&#39;: f&#39;/result/{filename}&#39;
}
return jsonify(response), 200
except Exception as e:
return jsonify({&#39;error&#39;: str(e)}), 500
@app.route(&#39;/result/&lt;filename&gt;&#39;)
def serve_result(filename):
return send_file(os.path.join(UPLOAD_FOLDER, filename))

if __name__ == &#39;__main__&#39;:
app.run(host=&#39;0.0.0.0&#39;, port=5000, debug=True)
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
&quot;detr-resnet-50&quot;: {
&quot;processor&quot;: &quot;facebook/detr-resnet-50&quot;,
&quot;model&quot;: &quot;facebook/detr-resnet-50&quot;
},
&quot;detr-resnet-101&quot;: {
&quot;processor&quot;: &quot;facebook/detr-resnet-101&quot;,
&quot;model&quot;: &quot;facebook/detr-resnet-101&quot;
},
&quot;detr-resnet-101-dc5&quot;: {
&quot;processor&quot;: &quot;facebook/detr-resnet-101-dc5&quot;,
&quot;model&quot;: &quot;facebook/detr-resnet-101-dc5&quot;
}
}
current_model = &quot;detr-resnet-101-dc5&quot;
processor = DetrImageProcessor.from_pretrained(
MODELS[current_model][&quot;processor&quot;],
size={&quot;shortest_edge&quot;: 800, &quot;longest_edge&quot;: 1333}
)
model = DetrForObjectDetection.from_pretrained(MODELS[current_model][&quot;model&quot;])
model.to(torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;))
def detect_objects(image_data, return_type=&#39;json&#39;, model_version=None):
global current_model, processor, model
if model_version and model_version in MODELS and model_version != current_model:
current_model = model_version
processor = DetrImageProcessor.from_pretrained(
MODELS[current_model][&quot;processor&quot;],
size={&quot;shortest_edge&quot;: 800, &quot;longest_edge&quot;: 1333}
)
model = DetrForObjectDetection.from_pretrained(MODELS[current_model][&quot;model&quot;])
model.to(torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;))
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
device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
inputs = processor(images=roi_image, return_tensors=&quot;pt&quot;).to(device)
start_time = time.time()
with torch.no_grad():
outputs = model(**inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
results = processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=0.6
)[0]
detection_results = {
&quot;objects&quot;: [],
&quot;count&quot;: 0,
&quot;inference_time&quot;: infer_time,
&quot;original_size&quot;: original_size,
&quot;model&quot;: &quot;DETR-ResNet101-DC5&quot;
}
if return_type == &#39;image&#39;:
draw = ImageDraw.Draw(image)
font = ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: {detection_results[&#39;model&#39;]}&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 30], f&quot;检测数量: {detection_results[&#39;count&#39;]}&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=font)
for i, obj in enumerate(detection_results[&#39;objects&#39;]):
box = obj[&#39;box&#39;]
class_name = obj[&#39;class&#39;]
score = obj[&#39;score&#39;]
color = colors[i % len(colors)]
draw.rectangle(box, outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=font)
draw.rectangle([box[0], box[1] - text_height - 5, box[0] + text_width + 5, box[1]],
fill=color)
draw.text([box[0] + 2, box[1] - text_height - 5], label_text, fill=&quot;white&quot;, font=font)
buffered = io.BytesIO()
image.save(buffered, format=&quot;JPEG&quot;)
return base64.b64encode(buffered.getvalue()).decode(&#39;utf-8&#39;)
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
raster_files = [f for f in os.listdir(raster_folder) if f.endswith(&#39;.tif&#39;)]
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
geometry_projected = row[&#39;geometry&#39;]
out_image, out_transform = mask(src, [geometry_projected], crop=True)
out_meta = src_meta.copy()
out_meta.update({
&quot;driver&quot;: &quot;GTiff&quot;,
&quot;height&quot;: out_image.shape[1],
&quot;width&quot;: out_image.shape[2],
&quot;transform&quot;: out_transform
})
base_filename = os.path.splitext(raster_file)[0]
out_filename = os.path.join(new_output_folder, f&quot;{base_filename}_clip_{index}.tif&quot;)
with rasterio.open(out_filename, &quot;w&quot;, **out_meta) as dest:
dest.write(out_image)
raster_folder = r&quot;C:\GIS DATA\Weather\wc2.1_cruts4.09_2.5m_tmin_2020-2024&quot;
shp_path = r&quot;C:\Users\123\Desktop\新建文件夹(1)\新建文件夹\TW_boundary.shp&quot;
output_folder = r&quot;C:\GIS DATA\Weather\cliped&quot;
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
x1 = boxes[:, 0]
y1 = boxes[:, 1]
x2 = boxes[:, 2]
y2 = boxes[:, 3]
areas = (x2 - x1 + 1) * (y2 - y1 + 1)
order = scores.argsort(descending=True)
keep = []
while order.numel() &gt; 0:

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
inds = torch.where(iou &lt;= threshold)[0]
order = order[inds + 1]
return torch.tensor(keep, dtype=torch.long)
def crop_to_roi(image, padding=0.15):
width, height = image.size
gray = image.convert(&quot;L&quot;)
edges = gray.filter(ImageFilter.FIND_EDGES)
edge_points = []
for x in range(width):
for y in range(height):
if edges.getpixel((x, y)) &gt; 100:
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
inputs = processor(images=roi_image, return_tensors=&quot;pt&quot;).to(device)
start_time = time.time()
with torch.no_grad():
outputs = model(** inputs)
infer_time = time.time() - start_time
target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
results = processor.post_process_object_detection(
outputs, target_sizes=target_sizes, threshold=0.6
)[0]
boxes = results[&quot;boxes&quot;].cpu()
scores = results[&quot;scores&quot;].cpu()
labels = results[&quot;labels&quot;].cpu()
keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
boxes = boxes[keep_indices]
scores = scores[keep_indices]
labels = labels[keep_indices]
bird_indices = []
for i, label in enumerate(labels):
class_name = model.config.id2label[label.item()].lower()
if &quot;bird&quot; in class_name:
bird_indices.append(i)
bird_indices = torch.tensor(bird_indices, dtype=torch.long)
results[&quot;boxes&quot;] = boxes[bird_indices]
results[&quot;scores&quot;] = scores[bird_indices]
results[&quot;labels&quot;] = labels[bird_indices]
if len(results[&quot;boxes&quot;]) &gt; 0:
results[&quot;boxes&quot;][:, 0] += crop_offset[0]
results[&quot;boxes&quot;][:, 1] += crop_offset[1]
results[&quot;boxes&quot;][:, 2] += crop_offset[0]
results[&quot;boxes&quot;][:, 3] += crop_offset[1]
draw = ImageDraw.Draw(image)
colors = [&#39;red&#39;, &#39;green&#39;, &#39;blue&#39;, &#39;yellow&#39;, &#39;purple&#39;, &#39;orange&#39;, &#39;cyan&#39;, &#39;magenta&#39;]
object_count = len(results[&quot;boxes&quot;])
draw.rectangle([0, 0, 400, 80], fill=&quot;black&quot;)
draw.text([5, 5], f&quot;模型: DETR-ResNet101-DC5&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 30], f&quot;检测鸟类数量: {object_count}&quot;, fill=&quot;white&quot;, font=font)
draw.text([5, 55], f&quot;推理时间: {infer_time:.2f}秒&quot;, fill=&quot;white&quot;, font=font)
print(f&quot;\n{os.path.basename(image_path)} 检测到 {object_count} 只鸟类&quot;)
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
class_name = model.config.id2label[label.item()]
print(f&quot;鸟类 {i+1}: {class_name} (置信度: {score:.2f})&quot;)
for i, (box, score, label) in enumerate(zip(results[&quot;boxes&quot;], results[&quot;scores&quot;],
results[&quot;labels&quot;])):
box = [int(coord) for coord in box.tolist()]
xmin, ymin, xmax, ymax = box
class_name = model.config.id2label[label.item()]
color = colors[i % len(colors)]
draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
label_text = f&quot;{class_name}: {score:.2f}&quot;
try:
bbox = draw.textbbox((0, 0), label_text, font=font)
text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
except AttributeError:
text_width, text_height = draw.textsize(label_text, font=font)
draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
draw.text([xmin + 2, ymin - text_height - 5], label_text, fill=&quot;white&quot;, font=font)
output_filename = f&quot;result_{os.path.basename(image_path)}&quot;
result_path = os.path.join(output_dir, output_filename)
image.save(result_path)
print(f&quot;结果已保存至: {result_path}&quot;)
except Exception as e:
print(f&quot;处理 {image_path} 时出错: {str(e)}&quot;)

def main():
root = Tk()
root.withdraw()
print(&quot;请选择包含图片的文件夹...&quot;)
input_dir = filedialog.askdirectory(title=&quot;选择图片文件夹&quot;)
if not input_dir:
print(&quot;未选择文件夹，程序退出&quot;)
return
output_dir = os.path.join(input_dir, &quot;鸟类识别结果&quot;)
os.makedirs(output_dir, exist_ok=True)
supported_formats = (&#39;.jpg&#39;, &#39;.jpeg&#39;, &#39;.png&#39;, &#39;.bmp&#39;, &#39;.gif&#39;, &#39;.tif&#39;, &#39;.tiff&#39;, &#39;.webp&#39;)
image_files = [
f for f in os.listdir(input_dir)
if os.path.isfile(os.path.join(input_dir, f)) and f.lower().endswith(supported_formats)
]
if not image_files:
print(f&quot;在 {input_dir} 中未找到支持的图片文件&quot;)
return
print(f&quot;找到 {len(image_files)} 个图片文件，开始处理...&quot;)
processor = DetrImageProcessor.from_pretrained(&quot;facebook/detr-resnet-101-dc5&quot;)
model = DetrForObjectDetection.from_pretrained(&quot;facebook/detr-resnet-101-dc5&quot;)
device = torch.device(&quot;cuda&quot; if torch.cuda.is_available() else &quot;cpu&quot;)
model.to(device)
print(f&quot;使用设备: {device.type.upper()}&quot;)
try:
font = ImageFont.truetype(&quot;simhei.ttf&quot;, 20)
except IOError:
try:
font = ImageFont.truetype(&quot;simsun.ttc&quot;, 20)
except IOError:
font = ImageFont.load_default()
print(&quot;警告: 无法加载中文字体，将使用默认字体&quot;)
for i, image_file in enumerate(image_files, 1):
image_path = os.path.join(input_dir, image_file)
print(f&quot;\n处理第 {i}/{len(image_files)} 个文件: {image_file}&quot;)
process_image(image_path, output_dir, processor, model, device, font)
print(&quot;\n所有图片处理完成！&quot;)
print(f&quot;所有结果已保存至: {output_dir}&quot;)
if __name__ == &quot;__main__&quot;:
main()
# 文件名: js/api.js
const OVERRIDE_BASE = window.API_BASE_URL ||
localStorage.getItem(&#39;API_BASE_URL&#39;);
const isLocalhost = window.location.hostname === &#39;localhost&#39;;
const BASE_URL = OVERRIDE_BASE !== null &amp;&amp; OVERRIDE_BASE !== undefined
? OVERRIDE_BASE
: &#39;http://localhost:8000&#39;;
const request = axios.create({
baseURL: BASE_URL,
timeout: 10000
});
request.interceptors.request.use(config =&gt; {
const token = localStorage.getItem(&#39;userToken&#39;);
if (token) {
config.headers[&#39;Authorization&#39;] = `Token ${token}`;
}
return config;
}, error =&gt; {
return Promise.reject(error);
});
request.interceptors.response.use(
response =&gt; response,
error =&gt; {
if (error.response &amp;&amp; error.response.status === 401) {
localStorage.removeItem(&#39;userToken&#39;);
localStorage.removeItem(&#39;username&#39;);
console.warn(&#39;Token 已失效，请重新登录&#39;);
}
return Promise.reject(error);
}
);
const API = {
login: async (username, password) =&gt; {
const form = new URLSearchParams();
form.append(&#39;username&#39;, username);
form.append(&#39;password&#39;, password);
return request.post(&#39;/api/login/&#39;, form, {
headers: { &#39;Content-Type&#39;: &#39;application/x-www-form-urlencoded&#39; }
});
},
getProfile: () =&gt; {
return request.get(&#39;/api/profiles/me/&#39;);
},
getObservations: () =&gt; {
return request.get(&#39;/api/observations/&#39;);
},
uploadObservation: (file, data) =&gt; {
const formData = new FormData();
formData.append(&#39;image&#39;, file);
formData.append(&#39;species&#39;, data.species || 1);
formData.append(&#39;count&#39;, data.count || 1);
formData.append(&#39;observation_time&#39;, data.observation_time || data.date || new
Date().toISOString().split(&#39;T&#39;)[0]);
if (data.description) formData.append(&#39;description&#39;, data.description);
if (data.lat) formData.append(&#39;lat&#39;, data.lat);
if (data.lng) formData.append(&#39;lng&#39;, data.lng);
if (data.zone) formData.append(&#39;zone&#39;, data.zone);
return request.post(&#39;/api/observations/&#39;, formData, {
headers: { &#39;Content-Type&#39;: &#39;multipart/form-data&#39; }
});
},
getProducts: () =&gt; {
return request.get(&#39;/api/products/&#39;);
},
redeemProduct: (productId) =&gt; {
return request.post(`/api/products/${productId}/redeem/`);
},

getZones: () =&gt; {
return request.get(&#39;/api/zones/&#39;);
},
getTransects: () =&gt; {
return request.get(&#39;/api/transects/&#39;);
}
};
window.API = API;
# 文件名: visualheader/main.js
import AuthManager from &#39;./auth.js&#39;;
const authManager = new AuthManager();
document.addEventListener(&#39;DOMContentLoaded&#39;, () =&gt; {
document.getElementById(&#39;register-btn&#39;)?.addEventListener(&#39;click&#39;, () =&gt; {
document.getElementById(&#39;popup-register-form&#39;).style.display = &#39;flex&#39;;
document.getElementById(&#39;popup-reg-username&#39;).focus();
});
document.getElementById(&#39;popup-cancel-register&#39;)?.addEventListener(&#39;click&#39;, () =&gt; {
document.getElementById(&#39;popup-register-form&#39;).style.display = &#39;none&#39;;
});
document.getElementById(&#39;menu-register-link&#39;)?.addEventListener(&#39;click&#39;, (e) =&gt; {
e.preventDefault();
const loginForm = document.getElementById(&#39;login-form&#39;);
const registerForm = document.getElementById(&#39;register-form&#39;);
loginForm.style.display = &#39;none&#39;;
registerForm.style.display = &#39;block&#39;;
registerForm.querySelector(&#39;#register-username&#39;).focus();
});
document.querySelector(&#39;[data-target=&quot;register-form&quot;]&#39;)?.addEventListener(&#39;click&#39;, () =&gt; {
const loginForm = document.getElementById(&#39;login-form&#39;);
const registerForm = document.getElementById(&#39;register-form&#39;);
loginForm.style.display = &#39;none&#39;;
registerForm.style.display = &#39;block&#39;;
registerForm.querySelector(&#39;#register-username&#39;).focus();
});
document.querySelector(&#39;[data-target=&quot;login-form&quot;]&#39;)?.addEventListener(&#39;click&#39;, () =&gt; {
const loginForm = document.getElementById(&#39;login-form&#39;);
const registerForm = document.getElementById(&#39;register-form&#39;);
registerForm.style.display = &#39;none&#39;;
loginForm.style.display = &#39;block&#39;;
loginForm.querySelector(&#39;#login-username&#39;).focus();
});
document.getElementById(&#39;submit-register&#39;)?.addEventListener(&#39;click&#39;, async () =&gt; {
const username = document.getElementById(&#39;reg-username&#39;).value;
const password = document.getElementById(&#39;reg-password&#39;).value;
if (!username || !password) {
alert(&#39;请输入用户名和密码&#39;);
return;
}

const result = await authManager.register(username, password);
if (result.success) {
alert(&#39;注册成功&#39;);
document.getElementById(&#39;register-form&#39;).style.display = &#39;none&#39;;
} else {
alert(`注册失败: ${result.message}`);
}
});
document.getElementById(&#39;do-logout&#39;)?.addEventListener(&#39;click&#39;, () =&gt; {
authManager.logout();
});
authManager.updateAuthUI();
});
# 文件名: visualheader/auth.js
class AuthManager {
constructor() {
this.currentUser = localStorage.getItem(&#39;username&#39;) || null;
}
async login(username, password) {
try {
const response = await window.API.login(username, password);
const token = response.data?.token;
if (!token) {
const msg = response.data?.message || &#39;登录返回未包含 token&#39;;
return { success: false, message: msg };
}
localStorage.setItem(&#39;userToken&#39;, token);
localStorage.setItem(&#39;username&#39;, username);
this.currentUser = username;
await this.fetchProfile();
this.updateAuthUI();
return { success: true };
} catch (error) {
console.error(&#39;登录失败:&#39;, error);
const message = error?.response?.data?.error || error.message || &#39;网络错误&#39;;
return { success: false, message };
}
}
async register() {
return { success: false, message: &#39;当前接口未提供注册功能，请联系管理员开通&#39; };
}
async fetchProfile() {
if (!localStorage.getItem(&#39;userToken&#39;)) return null;
try {
const res = await window.API.getProfile();
const profile = res.data;
return profile;
} catch (error) {
console.warn(&#39;获取用户信息失败&#39;, error);
return null;
}

}
logout() {
this.currentUser = null;
localStorage.removeItem(&#39;userToken&#39;);
localStorage.removeItem(&#39;username&#39;);
this.updateAuthUI();
return { success: true };
}
updateAuthUI() {
const authStatus = document.getElementById(&#39;auth-status&#39;);
const loginForm = document.getElementById(&#39;login-form&#39;);
const registerForm = document.getElementById(&#39;register-form&#39;);
const logoutBtn = document.getElementById(&#39;logout-btn&#39;);
if (!authStatus || !loginForm || !registerForm || !logoutBtn) return;
if (this.currentUser) {
authStatus.innerHTML = `&lt;span&gt;欢迎, ${this.currentUser}&lt;/span&gt;`;
loginForm.style.display = &#39;none&#39;;
registerForm.style.display = &#39;none&#39;;
logoutBtn.style.display = &#39;block&#39;;
} else {
authStatus.innerHTML = &#39;&lt;span&gt;未登录&lt;/span&gt;&#39; +
&#39;&lt;button id=&quot;login-btn&quot; class=&quot;auth-btn&quot;&gt;登录&lt;/button&gt;&#39; +
&#39;&lt;button id=&quot;register-btn&quot; class=&quot;auth-btn&quot;&gt;注册&lt;/button&gt;&#39;;
loginForm.style.display = &#39;none&#39;;
registerForm.style.display = &#39;none&#39;;
logoutBtn.style.display = &#39;none&#39;;
}
}
}
export default AuthManager;
# 文件名: visualheader/henan.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;河南省科技地图&lt;/title&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js&quot;&gt;&lt;/script&gt;
&lt;style&gt;
body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
#province-map { width: 100%; height: 80vh; }
.back-button {
position: fixed; top: 20px; left: 20px; padding: 8px 16px;
background: #1a2b5a; color: #fff; border: 1px solid #0a2dae;
border-radius: 4px; cursor: pointer; z-index: 100;
}
.province-info { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-
radius: 8px; }
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;


&lt;button class=&quot;back-button&quot; onclick=&quot;window.location.href=&#39;tech_map.html&#39;&quot;&gt;←返回全国
&lt;/button&gt;
&lt;button class=&quot;back-button&quot; onclick=&quot;window.location.href=&#39;wetland.html&#39;&quot; style=&quot;left:
120px;&quot;&gt;→郑州黄河湿地自然保护区&lt;/button&gt;
&lt;div id=&quot;province-map&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;province-info&quot;&gt;
&lt;h2&gt;河南省信息&lt;/h2&gt;
&lt;p&gt;面积：167000平方公里&lt;/p&gt;
&lt;p&gt;人口：9936万人&lt;/p&gt;
&lt;p&gt;GDP：61345亿元&lt;/p&gt;
&lt;/div&gt;
&lt;script&gt;
const mapChart = echarts.init(document.getElementById(&#39;province-map&#39;));
const provinceName = &#39;河南省&#39;;
const loadingEl = document.createElement(&#39;div&#39;);
loadingEl.style.position = &#39;fixed&#39;; loadingEl.style.top = &#39;50%&#39;; loadingEl.style.left = &#39;50%&#39;;
loadingEl.style.transform = &#39;translate(-50%, -50%)&#39;; loadingEl.style.color = &#39;#fff&#39;;
loadingEl.textContent = &#39;正在加载地图数据...&#39;;
document.body.appendChild(loadingEl);
$.get(`https://geo.datav.aliyun.com/areas_v3/bound/410000_full.json`)
.done(function(geoJson) {
echarts.registerMap(provinceName, geoJson);
document.body.removeChild(loadingEl);
mapChart.setOption({
backgroundColor: &#39;#0f1621&#39;,
title: { text: provinceName, left: &#39;center&#39;, textStyle: { color: &#39;#fff&#39; } },
geo: {
map: provinceName, roam: true,
itemStyle: { areaColor: &#39;#1a2b5a&#39;, borderColor: &#39;#0a2dae&#39; },
emphasis: { itemStyle: { areaColor: &#39;#2a91d8&#39; } }
}
});
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/tech_map.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;科技感中国地图&lt;/title&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js&quot;&gt;&lt;/script&gt;
&lt;style&gt;
body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
#china-map { width: 100%; height: 100vh; }
#back-to-china {
position: fixed; top: 20px; right: 20px; padding: 8px 16px;
background: #1a2b5a; color: #fff; border: 1px solid #0a2dae;
border-radius: 4px; cursor: pointer; display: none; z-index: 100;
}
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;div id=&quot;china-map&quot;&gt;&lt;/div&gt;

&lt;button id=&quot;back-to-china&quot;&gt;返回全国视图&lt;/button&gt;
&lt;button id=&quot;back-to-main&quot; style=&quot;position: fixed; top: 20px; left: 20px; padding: 8px 16px;
background: #1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer;
z-index: 100;&quot;&gt;返回主平台&lt;/button&gt;
&lt;script&gt;
$(function() {
const mapChart = echarts.init(document.getElementById(&#39;china-map&#39;));
const techMapOption = {
backgroundColor: &#39;#0f1621&#39;,
geo: {
map: &#39;china&#39;, roam: true,
itemStyle: { areaColor: &#39;#1a2b5a&#39;, borderColor: &#39;#0a2dae&#39;, borderWidth: 2,
shadowColor: &#39;rgba(0, 0, 0, 0.5)&#39;, shadowBlur: 10 },
emphasis: { itemStyle: { areaColor: &#39;#2a91d8&#39;, borderWidth: 3 }, label: { show: true,
color: &#39;#fff&#39;, fontSize: 14 } }
}
};
$.get(&#39;https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json&#39;, function(geoJson) {
echarts.registerMap(&#39;china&#39;, geoJson);
mapChart.setOption(techMapOption);
mapChart.on(&#39;click&#39;, function(params) {
const safeParams = { name: params.name, componentType: params.componentType,
geoIndex: params.geoIndex };
console.log(&#39;安全事件参数:&#39;, safeParams);
if (params.componentType === &#39;geo&#39;) {
const provinceMap = {
&#39;北京市&#39;: &#39;beijing.html&#39;, &#39;北京&#39;: &#39;beijing.html&#39;, &#39;天津&#39;:
&#39;tianjin.html&#39;, &#39;河北&#39;: &#39;hebei.html&#39;,
&#39;山西&#39;: &#39;shanxi.html&#39;, &#39;内蒙古&#39;: &#39;neimenggu.html&#39;, &#39;辽宁&#39;:
&#39;liaoning.html&#39;, &#39;吉林&#39;: &#39;jilin.html&#39;,
&#39;黑龙江&#39;: &#39;heilongjiang.html&#39;, &#39;上海&#39;: &#39;shanghai.html&#39;, &#39;江
苏&#39;: &#39;jiangsu.html&#39;, &#39;浙江&#39;: &#39;zhejiang.html&#39;,
&#39;安徽&#39;: &#39;anhui.html&#39;, &#39;福建&#39;: &#39;fujian.html&#39;, &#39;江西&#39;:
&#39;jiangxi.html&#39;, &#39;山东&#39;: &#39;shandong.html&#39;,
&#39;河南&#39;: &#39;henan.html&#39;, &#39;湖北&#39;: &#39;hubei.html&#39;, &#39;湖南&#39;:
&#39;hunan.html&#39;, &#39;广东&#39;: &#39;guangdong.html&#39;,
&#39;广西&#39;: &#39;guangxi.html&#39;, &#39;海南&#39;: &#39;hainan.html&#39;, &#39;重庆&#39;:
&#39;chongqing.html&#39;, &#39;四川&#39;: &#39;sichuan.html&#39;,
&#39;贵州&#39;: &#39;guizhou.html&#39;, &#39;云南&#39;: &#39;yunnan.html&#39;, &#39;西藏&#39;:
&#39;xizang.html&#39;, &#39;陕西&#39;: &#39;shanxi1.html&#39;,
&#39;甘肃&#39;: &#39;gansu.html&#39;, &#39;青海&#39;: &#39;qinghai.html&#39;, &#39;宁夏&#39;:
&#39;ningxia.html&#39;, &#39;新疆&#39;: &#39;xinjiang.html&#39;,
&#39;台湾&#39;: &#39;taiwan.html&#39;, &#39;香港&#39;: &#39;hongkong.html&#39;, &#39;澳门&#39;:
&#39;macao.html&#39;
};
const matchedKey = Object.keys(provinceMap).find(key =&gt;
key.includes(params.name) || params.name.includes(key));
if(matchedKey) {
const basePath = window.location.href.replace(&#39;tech_map.html&#39;, &#39;&#39;);
const targetUrl = basePath + provinceMap[matchedKey];
setTimeout(() =&gt; {
fetch(targetUrl, {method: &#39;HEAD&#39;}).then(response =&gt; {
if(response.ok) { window.location.href = targetUrl; }
else { alert(&#39;抱歉，该省份页面暂不可用&#39;); }
}).catch(error =&gt; { alert(&#39;跳转过程中发生错误&#39;); });
}, 100);
}

}
});
});
$(&#39;#back-to-main&#39;).click(function() { window.location.href = &#39;../visualheader/testB.html&#39;;
});
$(&#39;#back-to-china&#39;).click(function() { mapChart.setOption(techMapOption); $(this).hide();
});
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/rain.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;空天地一体化可视化平台&lt;/title&gt;
&lt;style&gt;
body {
margin: 0; padding: 0; font-family: &#39;Arial&#39;, sans-serif;
background: #0a1625; color: #fff; min-height: 100vh; position: relative; overflow-x: hidden;
}
body::before {
content: &quot;&quot;; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
background: linear-gradient(rgba(0, 120, 255, 0.1) 1px, transparent 1px),
linear-gradient(90deg, rgba(0, 120, 255, 0.1) 1px, transparent 1px);
background-size: 40px 40px; z-index: -1;
}
h1 {
text-align: center; padding: 25px; font-size: 2.8em;
text-shadow: 0 0 15px rgba(0, 180, 255, 0.7); margin: 0;
background: rgba(0, 40, 80, 0.5); border-bottom: 1px solid rgba(0, 180, 255, 0.3);
}
.dashboard { display: flex; flex-direction: column; height: 80vh; padding: 30px; margin: 0 auto;
width: 90%; min-width: 800px; max-width: 1300px; }
.module {
background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding: 25px;
box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px);
border: 1px solid rgba(0, 180, 255, 0.3); transition: all 0.3s ease;
}
.module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0, 120, 255, 0.3);
}
.module h2 { margin-top: 0; color: #00b4ff; padding-bottom: 15px; font-size: 1.6em; border-
bottom: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; }
.module h2::before { content: &quot;&quot;; display: inline-block; width: 10px; height: 10px; background:
#00b4ff; border-radius: 50%; margin-right: 10px; box-shadow: 0 0 8px #00b4ff; }
.module p { color: #b3e0ff; line-height: 1.7; margin-bottom: 20px; }
.chart-container { height: 500px; background: rgba(0, 80, 160, 0.2); border-radius: 6px; border:
1px dashed rgba(0, 180, 255, 0.3); display: flex; align-items: center; justify-content: center; color:
#66c2ff; font-size: 1.1em; }
.status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
background: #00ff88; box-shadow: 0 0 8px #00ff88; margin-right: 8px; }
.target-recognition { margin-top: 20px; padding: 15px; background: rgba(0, 80, 160, 0.3);
border-radius: 6px; border: 2px dashed rgba(0, 180, 255, 0.5); }
.target-recognition h3 { color: #00ffaa; margin-top: 0; font-size: 1.2em; }
.recognition-box { height: 120px; background: rgba(0, 60, 120, 0.2); border: 1px solid rgba(0,

180, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #66ffcc; }
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;h1&gt;空天地一体化可视化平台&lt;/h1&gt;
&lt;div class=&quot;dashboard&quot;&gt;
&lt;div class=&quot;module&quot;&gt;
&lt;h2&gt;&lt;span class=&quot;status-indicator&quot;&gt;&lt;/span&gt;降水量&lt;/h2&gt;
&lt;p&gt;目标分布降水量展示&lt;/p&gt;
&lt;div class=&quot;chart-container&quot;&gt;降水量展示&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/testB.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;郑州黄河湿地空天地一体化智能监测平台&lt;/title&gt;
&lt;style&gt;
body { margin: 0; padding: 0; font-family: &#39;Arial&#39;, sans-serif; background: #0a1625; color:
#fff; min-height: 100vh; position: relative; overflow-x: hidden; transition: margin-left 0.5s; }
body::before { content: &quot;&quot;; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background:
linear-gradient(rgba(0, 120, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 120,
255, 0.1) 1px, transparent 1px); background-size: 40px 40px; z-index: -1; }
h1 { text-align: center; padding: 25px; font-size: 2.8em; text-shadow: 0 0 15px rgba(0, 180,
255, 0.7); margin: 0; background: rgba(0, 40, 80, 0.5); border-bottom: 1px solid rgba(0, 180, 255,
0.3); }
.container { display: flex; justify-content: space-between; align-items: flex-start; padding:
30px; max-width: 1400px; margin-left: 60px; transition: margin-left 0.5s; }
.container-expanded { margin-left: 210px; }
.sidebar { display: flex; flex-direction: column; gap: 25px; width: 200px; }
.sidebar-collapsed { width: 50px; height: 100vh; position: fixed; left: 0; top: 0; background:
rgba(10, 30, 60, 0.9); z-index: 1000; cursor: pointer; display: flex; flex-direction: column; align-
items: center; justify-content: flex-start; padding-top: 20px; border-right: 1px solid rgba(0, 180,
255, 0.3); transition: width 0.3s; }
.sidebar-expanded { width: 200px; }
.sidebar-menu { display: none; width: 100%; padding: 10px; }
.sidebar-expanded .sidebar-menu { display: block; }
.sidebar-menu-item { padding: 10px; color: #b3e0ff; cursor: pointer; border-bottom: 1px
solid rgba(0, 180, 255, 0.2); transition: all 0.3s; }
.sidebar-menu-item:hover { background: rgba(0, 100, 255, 0.2); color: #00ff88; }
.module { background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding: 10px; box-shadow:
0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px); border: 1px solid rgba(0, 180, 255,
0.3); transition: all 0.3s ease; cursor: pointer; position: relative; display: none; opacity: 0;
transform: translateY(20px); transition: opacity 0.3s, transform 0.3s; }
.module.active { display: block; opacity: 1; transform: translateY(0); }
.module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0, 120, 255,
0.3); }
.module h2 { margin-top: 0; color: #00b4ff; padding-bottom: 5px; font-size: 1.4em; border-
bottom: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center; }
.module h2::before { content: &quot;&quot;; display: inline-block; width: 10px; height: 10px;
background: #00b4ff; border-radius: 50%; margin-right: 10px; box-shadow: 0 0 8px #00b4ff; }
.module p { color: #b3e0ff; line-height: 1.7; margin-bottom: 10px; }
.chart-container { display: none; width: 600px; height: 400px; background: rgba(0, 80, 160,

0.2); border-radius: 6px; border: 1px dashed rgba(0, 180, 255, 0.3); color: #66c2ff; font-size:
1.1em; position: absolute; top: 150px; left: 50%; transform: translateX(-50%); z-index: 1; }
.chart-container.show { display: block; }
.status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
background: #00ff88; box-shadow: 0 0 8px #00ff88; margin-right: 8px; }
.target-recognition-container { display: flex; justify-content: center; align-items: center;
padding: 30px; }
.target-recognition-module { background: rgba(10, 30, 60, 0.8); border-radius: 8px; padding:
10px; box-shadow: 0 8px 32px rgba(0, 100, 255, 0.2); backdrop-filter: blur(6px); border: 1px solid
rgba(0, 180, 255, 0.3); transition: all 0.3s ease; cursor: pointer; width: 600px; height: 400px;
position: relative; }
.target-recognition-module:hover { transform: translateY(-5px); box-shadow: 0 12px 40px
rgba(0, 120, 255, 0.3); }
.target-recognition-module h2 { margin-top: 0; color: #00b4ff; padding-bottom: 5px; font-
size: 1.4em; border-bottom: 1px solid rgba(0, 180, 255, 0.3); display: flex; align-items: center;
justify-content: space-between; }
.recognition-box { height: 300px; background: rgba(0, 60, 120, 0.2); border: 1px solid rgba(0,
180, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #66c2ff; }
.login-page { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
background: rgba(0, 10, 20, 0.9); z-index: 2000; align-items: center; justify-content: center; }
.login-form-container { background: rgba(10, 30, 60, 0.95); padding: 30px; border-radius:
10px; width: 350px; box-shadow: 0 0 50px rgba(0, 100, 255, 0.3); border: 1px solid rgba(0, 180,
255, 0.5); }
.login-form-container h2 { color: #00b4ff; text-align: center; margin-bottom: 25px; font-size:
1.8em; }
.login-form-container input { width: 100%; padding: 12px; margin: 10px 0; background:
rgba(0, 40, 80, 0.5); border: 1px solid rgba(0, 180, 255, 0.3); color: white; border-radius: 4px; }
.auth-container { position: absolute; top: 20px; right: 20px; z-index: 1000; }
.auth-status { background: rgba(10, 30, 60, 0.8); padding: 10px 15px; border-radius: 20px;
color: #b3e0ff; display: flex; align-items: center; gap: 10px; }
.auth-btn { background: rgba(0, 120, 255, 0.3); color: white; border: 1px solid rgba(0, 180,
255, 0.5); padding: 5px 10px; border-radius: 4px; cursor: pointer; transition: all 0.3s; }
.auth-btn:hover { background: rgba(0, 120, 255, 0.5); }
.upload-area { display: flex; flex-direction: column; align-items: center; justify-content:
center; height: 100%; padding: 20px; border: 2px dashed rgba(0, 180, 255, 0.5); border-radius:
8px; margin-bottom: 20px; }
.detect-button { background: rgba(0, 200, 100, 0.3); color: white; border: 1px solid rgba(0,
255, 128, 0.5); padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; transition:
all 0.3s; margin-top: 15px; display: none; }
.detect-button:hover { background: rgba(0, 200, 100, 0.5); }
&lt;/style&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/chart.js&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js&quot;&gt;&lt;/script&gt;
&lt;script src=&quot;./auth.js&quot; type=&quot;module&quot;&gt;&lt;/script&gt;
&lt;script&gt;
let batchMode = false;
let batchFiles = [];
let batchResults = [];
document.addEventListener(&#39;DOMContentLoaded&#39;, function() {
const sidebar = document.createElement(&#39;div&#39;);
sidebar.className = &#39;sidebar-collapsed&#39;;
sidebar.innerHTML = `
&lt;div class=&quot;profile-icon&quot;&gt;&lt;img
src=&quot;data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwM
C9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJDNi40NzkgMiAyIDYu

NDc5IDIgMTJzNC40NzkgMTAgMTAgMTAgMTAtNC40NzkgMTAtMTBTMTcuNTIxIDIgMTI
gMnptMCAyYzQuNDE5IDAgOCAzLjU4MSA4IDhzLTMuNTgxIDgtOCA4LTgtMy41ODEtOC
04IDMuNTgxLTggOC04em0wIDJjLTIuMjA5IDAtNCAxLjc5MS00IDQgMCAxLjMwMy43OD
cgMi40MDQgMS45NzcgMi45MDFDNy45MjUgMTIuODQ0IDcgMTEuNTU3IDcgMTBjMC0y
Ljc2MSAyLjIzOS01IDUtNXM1IDIuMjM5IDUgNWMwIDEuNTU3LS45MjUgMi44NDQtMi4y
NzcgMy40MDFDMTYuMjEzIDEyLjQwNCAxNyAxMS4zMDMgMTcgMTBjMC0yLjIwOS0xL
jc5MS00LTQtNHoiIGZpbGw9IiMwMGI0ZmYiLz48L3N2Zz4=&quot; alt=&quot;Profile&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;sidebar-menu&quot;&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;login-form&quot;&gt;登录&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;real-time-monitor&quot;&gt;实时监控&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;temperature-monitor&quot;&gt;温度监控&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;humidity-monitor&quot;&gt;湿度监控&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;distribution-monitor&quot;&gt;分布监控&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;precipitation-monitor&quot;&gt;降水监控
&lt;/div&gt;
&lt;div class=&quot;sidebar-menu-item&quot; data-target=&quot;target-recognition-module&quot;&gt;目标识别
&lt;/div&gt;
&lt;/div&gt;
`;
document.body.insertBefore(sidebar, document.body.firstChild);
sidebar.addEventListener(&#39;click&#39;, function(e) {
if (e.target.classList.contains(&#39;sidebar-icon&#39;) || e.target.classList.contains(&#39;sidebar-
collapsed&#39;)) {
sidebar.classList.toggle(&#39;sidebar-expanded&#39;);
document.querySelector(&#39;.container&#39;).classList.toggle(&#39;container-expanded&#39;);
}
});
document.addEventListener(&#39;click&#39;, function(e) {
if (e.target.classList.contains(&#39;sidebar-menu-item&#39;)) {
const targetId = e.target.getAttribute(&#39;data-target&#39;);
const targetElement = document.getElementById(targetId);
if (targetElement) {
targetElement.classList.toggle(&#39;active&#39;);
if (targetId === &#39;target-recognition-module&#39;) {
const container = document.querySelector(&#39;.target-recognition-container&#39;);
container.style.display = container.style.display === &#39;none&#39; ? &#39;flex&#39; : &#39;none&#39;;
}
}
}
});
interact(&#39;.chart-container&#39;).draggable({ inertia: false, autoScroll: false, listeners: { move:
dragMoveListener } });
interact(&#39;.module:not(#target-recognition-module)&#39;).draggable({ inertia: false, autoScroll:
false, listeners: { move: dragMoveListener } });
function dragMoveListener(event) {
const target = event.target;
const x = (parseFloat(target.getAttribute(&#39;data-x&#39;)) || 0) + event.dx;
const y = (parseFloat(target.getAttribute(&#39;data-y&#39;)) || 0) + event.dy;
target.style.transform = `translate(${x}px, ${y}px)`;
target.setAttribute(&#39;data-x&#39;, x);
target.setAttribute(&#39;data-y&#39;, y);
}
document.querySelectorAll(&#39;.module h2&#39;).forEach(header =&gt; {
header.addEventListener(&#39;click&#39;, function() {
const chartContainer = this.parentElement.querySelector(&#39;.chart-container&#39;);
if (chartContainer) { chartContainer.classList.toggle(&#39;show&#39;); }
});

});
document.querySelector(&#39;.target-recognition-container&#39;).style.display = &#39;none&#39;;
document.querySelector(&#39;.profile-icon&#39;).addEventListener(&#39;click&#39;, function() {
document.querySelector(&#39;.sidebar-collapsed&#39;).classList.toggle(&#39;sidebar-expanded&#39;);
document.querySelector(&#39;.container&#39;).classList.toggle(&#39;container-expanded&#39;);
});
const loginPage = document.createElement(&#39;div&#39;);
loginPage.className = &#39;login-page&#39;;
loginPage.innerHTML = `
&lt;div class=&quot;login-form-container&quot;&gt;
&lt;div class=&quot;auth-tabs&quot;&gt;
&lt;button class=&quot;auth-tab active&quot; data-tab=&quot;login&quot;&gt;登录&lt;/button&gt;
&lt;button class=&quot;auth-tab&quot; data-tab=&quot;register&quot;&gt;注册&lt;/button&gt;
&lt;/div&gt;
&lt;div id=&quot;login-form&quot; class=&quot;auth-form active&quot;&gt;
&lt;h2&gt;用户登录&lt;/h2&gt;
&lt;input type=&quot;text&quot; id=&quot;login-username&quot; placeholder=&quot;用户名&quot;&gt;
&lt;input type=&quot;password&quot; id=&quot;login-password&quot; placeholder=&quot;密码&quot;&gt;
&lt;div class=&quot;login-options&quot;&gt;
&lt;label class=&quot;remember-me&quot;&gt;&lt;input type=&quot;checkbox&quot; id=&quot;remember-me&quot;&gt; 记住
我&lt;/label&gt;
&lt;a href=&quot;#&quot; class=&quot;forgot-password&quot;&gt;忘记密码?&lt;/a&gt;
&lt;/div&gt;
&lt;div class=&quot;login-buttons&quot;&gt;
&lt;button id=&quot;login-submit&quot; class=&quot;login-submit&quot;&gt;登录&lt;/button&gt;
&lt;button id=&quot;login-cancel&quot; class=&quot;login-cancel&quot;&gt;取消&lt;/button&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;div id=&quot;register-form&quot; class=&quot;auth-form&quot;&gt;
&lt;h2&gt;用户注册&lt;/h2&gt;
&lt;input type=&quot;text&quot; id=&quot;register-username&quot; placeholder=&quot;用户名&quot;&gt;
&lt;input type=&quot;password&quot; id=&quot;register-password&quot; placeholder=&quot;密码&quot;&gt;
&lt;input type=&quot;password&quot; id=&quot;register-confirm&quot; placeholder=&quot;确认密码&quot;&gt;
&lt;div class=&quot;security-question&quot;&gt;&lt;select id=&quot;security-question&quot;&gt;&lt;option value=&quot;&quot;&gt;选
择安全问题&lt;/option&gt;&lt;/select&gt;&lt;/div&gt;
&lt;input type=&quot;text&quot; id=&quot;security-answer&quot; placeholder=&quot;安全问题答案&quot;&gt;
&lt;div class=&quot;login-buttons&quot;&gt;
&lt;button id=&quot;register-submit&quot; class=&quot;login-submit&quot;&gt;注册&lt;/button&gt;
&lt;button id=&quot;register-cancel&quot; class=&quot;login-cancel&quot;&gt;取消&lt;/button&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
`;
document.body.appendChild(loginPage);
const users = { &#39;admin&#39;: &#39;******&#39;, &#39;user&#39;: &#39;******&#39; };
initBatchProcessing();
});
function initBatchProcessing() {
const recognitionModule = document.querySelector(&#39;.target-recognition-module h2&#39;);
if (recognitionModule) {
const toggleBtn = document.createElement(&#39;button&#39;);
toggleBtn.className = &#39;batch-mode-toggle&#39;;
toggleBtn.textContent = &#39;批量模式&#39;;
toggleBtn.onclick = toggleBatchMode;
recognitionModule.appendChild(toggleBtn);
}

}
function toggleBatchMode() {
batchMode = !batchMode;
const toggleBtn = document.querySelector(&#39;.batch-mode-toggle&#39;);
const uploadArea = document.getElementById(&#39;upload-area&#39;);
if (batchMode) {
toggleBtn.classList.add(&#39;active&#39;); toggleBtn.textContent = &#39;单张模式&#39;;
if (!document.getElementById(&#39;batch-upload-container&#39;)) { createBatchUploadUI(); }
uploadArea.style.display = &#39;none&#39;;
document.getElementById(&#39;batch-upload-container&#39;).style.display = &#39;flex&#39;;
} else {
toggleBtn.classList.remove(&#39;active&#39;); toggleBtn.textContent = &#39;批量模式&#39;;
uploadArea.style.display = &#39;flex&#39;;
const batchContainer = document.getElementById(&#39;batch-upload-container&#39;);
if (batchContainer) { batchContainer.style.display = &#39;none&#39;; }
}
}
function createBatchUploadUI() {
const recognitionBox = document.querySelector(&#39;.recognition-box&#39;);
const batchContainer = document.createElement(&#39;div&#39;);
batchContainer.id = &#39;batch-upload-container&#39;;
batchContainer.className = &#39;batch-upload-container&#39;;
batchContainer.style.display = &#39;none&#39;;
batchContainer.innerHTML = `&lt;div style=&quot;width: 100%; height: 100%; display: flex; flex-
direction: column;&quot;&gt;&lt;div class=&quot;upload-area&quot; style=&quot;min-height: 150px;&quot;&gt;&lt;input type=&quot;file&quot;
id=&quot;batch-image-upload&quot; accept=&quot;image/*&quot; multiple style=&quot;display:none&quot;&gt;&lt;button id=&quot;batch-
upload-button&quot;&gt;选择多个图片&lt;/button&gt;&lt;div class=&quot;batch-file-list&quot; id=&quot;batch-file-
list&quot;&gt;&lt;/div&gt;&lt;/div&gt;&lt;button id=&quot;batch-detect-button&quot; class=&quot;detect-button&quot; style=&quot;display:none;&quot;&gt;
批量检测&lt;/button&gt;&lt;div class=&quot;batch-summary&quot; id=&quot;batch-summary&quot;&gt;&lt;div class=&quot;batch-
summary-stats&quot;&gt;&lt;div class=&quot;batch-stat-item&quot;&gt;&lt;div class=&quot;batch-stat-value&quot; id=&quot;batch-total-
images&quot;&gt;0&lt;/div&gt;&lt;div class=&quot;batch-stat-label&quot;&gt;总图片&lt;/div&gt;&lt;/div&gt;&lt;div class=&quot;batch-stat-
item&quot;&gt;&lt;div class=&quot;batch-stat-value&quot; id=&quot;batch-total-birds&quot;&gt;0&lt;/div&gt;&lt;div class=&quot;batch-stat-label&quot;&gt;
检测鸟类&lt;/div&gt;&lt;/div&gt;&lt;div class=&quot;batch-stat-item&quot;&gt;&lt;div class=&quot;batch-stat-value&quot; id=&quot;batch-avg-
time&quot;&gt;0&lt;/div&gt;&lt;div class=&quot;batch-stat-label&quot;&gt;平均用时(秒)&lt;/div&gt;&lt;/div&gt;&lt;/div&gt;&lt;div
class=&quot;batch-controls&quot;&gt;&lt;button class=&quot;batch-download-btn&quot; onclick=&quot;downloadBatchResults()&quot;&gt;
下载结果&lt;/button&gt;&lt;button class=&quot;batch-clear-btn&quot; onclick=&quot;clearBatchResults()&quot;&gt;清空
&lt;/button&gt;&lt;/div&gt;&lt;/div&gt;&lt;div class=&quot;batch-results-grid&quot; id=&quot;batch-results-grid&quot;&gt;&lt;/div&gt;&lt;div
class=&quot;batch-processing-overlay&quot; id=&quot;batch-processing-overlay&quot;&gt;&lt;div class=&quot;batch-processing-
content&quot;&gt;&lt;div class=&quot;batch-spinner&quot;&gt;&lt;/div&gt;&lt;div&gt;正在处理...&lt;/div&gt;&lt;div id=&quot;batch-
progress&quot;&gt;0 / 0&lt;/div&gt;&lt;/div&gt;&lt;/div&gt;&lt;/div&gt;`;
recognitionBox.appendChild(batchContainer);
document.getElementById(&#39;batch-upload-button&#39;).addEventListener(&#39;click&#39;, () =&gt; {
document.getElementById(&#39;batch-image-upload&#39;).click(); });
document.getElementById(&#39;batch-image-upload&#39;).addEventListener(&#39;change&#39;,
handleBatchFileSelect);
document.getElementById(&#39;batch-detect-button&#39;).addEventListener(&#39;click&#39;,
processBatchDetection);
}
function handleBatchFileSelect(event) {
batchFiles = Array.from(event.target.files);
const fileList = document.getElementById(&#39;batch-file-list&#39;);
if (batchFiles.length &gt; 0) {
fileList.style.display = &#39;block&#39;;
fileList.innerHTML = `&lt;div style=&quot;color:#00b4ff;margin-bottom:5px;&quot;&gt;已选择

${batchFiles.length} 个文件:&lt;/div&gt;`;
batchFiles.forEach(file =&gt; {
const item = document.createElement(&#39;div&#39;);
item.className = &#39;batch-file-item&#39;;
item.textContent = file.name;
fileList.appendChild(item);
});
document.getElementById(&#39;batch-detect-button&#39;).style.display = &#39;block&#39;;
}
}
async function processBatchDetection() {
if (batchFiles.length === 0) return;
const overlay = document.getElementById(&#39;batch-processing-overlay&#39;);
overlay.classList.add(&#39;show&#39;);
const formData = new FormData();
batchFiles.forEach(file =&gt; { formData.append(&#39;images&#39;, file); });
try {
const response = await fetch(&#39;http://localhost:5050/api/batch_detect&#39;, { method: &#39;POST&#39;,
body: formData });
const data = await response.json();
if (data.success) { displayBatchResults(data); } else { alert(&#39;批量检测失败: &#39; +
data.error); }
} catch (error) { alert(&#39;请求失败: &#39; + error.message); }
finally { overlay.classList.remove(&#39;show&#39;); }
}
function displayBatchResults(data) {
batchResults = data.results;
document.getElementById(&#39;batch-total-images&#39;).textContent = data.total_images;
document.getElementById(&#39;batch-total-birds&#39;).textContent = data.total_birds;
const avgTime = data.results.reduce((sum, r) =&gt; sum + (r.inference_time || 0), 0) /
data.results.length;
document.getElementById(&#39;batch-avg-time&#39;).textContent = avgTime.toFixed(2);
document.getElementById(&#39;batch-summary&#39;).style.display = &#39;block&#39;;
const grid = document.getElementById(&#39;batch-results-grid&#39;);
grid.innerHTML = &#39;&#39;;
data.results.forEach(result =&gt; {
if (result.success) {
const item = document.createElement(&#39;div&#39;);
item.className = &#39;batch-result-item&#39;;
item.innerHTML = `&lt;img src=&quot;data:image/png;base64,${result.image}&quot;
alt=&quot;${result.filename}&quot;&gt;&lt;div class=&quot;batch-result-info&quot;&gt;&lt;div style=&quot;font-
weight:bold;&quot;&gt;${result.filename}&lt;/div&gt;&lt;div&gt;鸟类: ${result.count}&lt;/div&gt;&lt;/div&gt;`;
grid.appendChild(item);
}
});
}
async function downloadBatchResults() {
if (batchResults.length === 0) return;
const response = await fetch(&#39;http://localhost:5050/api/download_results&#39;, { method:
&#39;POST&#39;, headers: {&#39;Content-Type&#39;: &#39;application/json&#39;}, body: JSON.stringify({ images:
batchResults.filter(r =&gt; r.success).map(r =&gt; ({ filename: &#39;result_&#39; + r.filename, image: r.image }))
}) });
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);

const a = document.createElement(&#39;a&#39;);
a.href = url; a.download = &#39;bird_detection_results.zip&#39;; a.click();
}
function clearBatchResults() {
batchFiles = []; batchResults = [];
document.getElementById(&#39;batch-file-list&#39;).innerHTML = &#39;&#39;;
document.getElementById(&#39;batch-file-list&#39;).style.display = &#39;none&#39;;
document.getElementById(&#39;batch-results-grid&#39;).innerHTML = &#39;&#39;;
document.getElementById(&#39;batch-summary&#39;).style.display = &#39;none&#39;;
document.getElementById(&#39;batch-detect-button&#39;).style.display = &#39;none&#39;;
}
&lt;/script&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;div class=&quot;auth-container&quot;&gt;
&lt;div class=&quot;auth-status&quot; id=&quot;auth-status&quot;&gt;
&lt;span&gt;未登录&lt;/span&gt;
&lt;button id=&quot;login-btn&quot; class=&quot;auth-btn&quot;&gt;登录&lt;/button&gt;
&lt;button id=&quot;register-btn&quot; class=&quot;auth-btn&quot;&gt;注册&lt;/button&gt;
&lt;a href=&quot;simple_register.html&quot; style=&quot;margin-left:10px;color:#1890ff;&quot;&gt;[独立注册]&lt;/a&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;h1&gt;郑州黄河湿地空天地一体化智能监测平台&lt;/h1&gt;
&lt;div class=&quot;container&quot;&gt;
&lt;div class=&quot;map-container&quot; id=&quot;china-map&quot; style=&quot;width: 100%; height: 600px;&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;sidebar&quot;&gt;
&lt;div class=&quot;module&quot; id=&quot;real-time-monitor&quot;&gt;&lt;h2&gt;&lt;span class=&quot;status-indicator&quot;&gt;&lt;/span&gt;实
时监控&lt;/h2&gt;&lt;p&gt;系统运行状态实时监测&lt;/p&gt;&lt;div class=&quot;chart-container&quot; id=&quot;real-time-chart-
container&quot;&gt;&lt;canvas id=&quot;real-time-chart&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;&lt;/div&gt;
&lt;div class=&quot;module&quot; id=&quot;temperature-monitor&quot;&gt;&lt;h2&gt;&lt;span class=&quot;status-
indicator&quot;&gt;&lt;/span&gt;温度监测&lt;/h2&gt;&lt;p&gt;环境温度数据可视化&lt;/p&gt;&lt;div class=&quot;chart-container&quot;
id=&quot;temperature-chart-container&quot;&gt;&lt;canvas id=&quot;temperature-chart&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;&lt;/div&gt;
&lt;div class=&quot;module&quot; id=&quot;humidity-monitor&quot;&gt;&lt;h2&gt;&lt;span class=&quot;status-indicator&quot;&gt;&lt;/span&gt;湿
度监测&lt;/h2&gt;&lt;p&gt;环境湿度数据可视化&lt;/p&gt;&lt;div class=&quot;chart-container&quot; id=&quot;humidity-chart-
container&quot;&gt;&lt;canvas id=&quot;humidity-chart&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;&lt;/div&gt;
&lt;/div&gt;
&lt;div class=&quot;main-content&quot;&gt;
&lt;div class=&quot;chart-container&quot; id=&quot;distribution-chart-container&quot;&gt;&lt;canvas id=&quot;distribution-
chart&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;
&lt;div class=&quot;chart-container&quot; id=&quot;precipitation-chart-container&quot;&gt;&lt;canvas id=&quot;precipitation-
chart&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;
&lt;/div&gt;
&lt;div class=&quot;sidebar&quot;&gt;
&lt;div class=&quot;module&quot; id=&quot;distribution-monitor&quot;&gt;&lt;h2&gt;&lt;span class=&quot;status-indicator&quot;&gt;&lt;/span&gt;
分布状况&lt;/h2&gt;&lt;p&gt;目标分布热力图展示&lt;/p&gt;&lt;div class=&quot;chart-container&quot; id=&quot;distribution-
chart-container2&quot;&gt;&lt;canvas id=&quot;distribution-chart2&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;&lt;/div&gt;
&lt;div class=&quot;module&quot; id=&quot;precipitation-monitor&quot;&gt;&lt;h2&gt;&lt;span class=&quot;status-
indicator&quot;&gt;&lt;/span&gt;降水量&lt;/h2&gt;&lt;p&gt;目标分布降水量展示&lt;/p&gt;&lt;div class=&quot;chart-container&quot;
id=&quot;precipitation-chart-container2&quot;&gt;&lt;canvas id=&quot;precipitation-chart2&quot;&gt;&lt;/canvas&gt;&lt;/div&gt;&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;div class=&quot;target-recognition-container&quot; style=&quot;display:none;&quot;&gt;
&lt;div class=&quot;target-recognition-module&quot; id=&quot;target-recognition-module&quot;&gt;
&lt;h2&gt;&lt;span class=&quot;status-indicator&quot;&gt;&lt;/span&gt;目标识别&lt;/h2&gt;
&lt;div class=&quot;recognition-box&quot;&gt;
&lt;div class=&quot;upload-area&quot; id=&quot;upload-area&quot;&gt;

&lt;input type=&quot;file&quot; id=&quot;image-upload&quot; accept=&quot;image/*&quot; style=&quot;display:none&quot;&gt;
&lt;button id=&quot;upload-button&quot;&gt;选择或拖放图片&lt;/button&gt;
&lt;div class=&quot;preview-container&quot; id=&quot;preview-container&quot;&gt;&lt;/div&gt;
&lt;button id=&quot;detect-button&quot; class=&quot;detect-button&quot; disabled&gt;开始检测&lt;/button&gt;
&lt;/div&gt;
&lt;div class=&quot;result-container&quot; id=&quot;result-container&quot;&gt;
&lt;div class=&quot;detection-image&quot; id=&quot;detection-image&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;detection-data&quot; id=&quot;detection-data&quot;&gt;&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;/div&gt;
&lt;script&gt;
document.addEventListener(&#39;DOMContentLoaded&#39;, function() {
function createChart(canvasId) {
const canvas = document.getElementById(canvasId);
if (!canvas) return;
const ctx = canvas.getContext(&#39;2d&#39;);
return new Chart(ctx, { type: &#39;line&#39;, data: { labels: [&#39;January&#39;, &#39;February&#39;, &#39;March&#39;, &#39;April&#39;,
&#39;May&#39;, &#39;June&#39;, &#39;July&#39;], datasets: [{ label: &#39;数据曲线&#39;, data: [65, 59, 80, 81, 56, 55, 40],
borderColor: &#39;#00b4ff&#39;, borderWidth: 1 }] }, options: { responsive: true, plugins: { legend: {
position: &#39;top&#39; }, title: { display: true, text: &#39;数据曲线图&#39; } } } });
}
createChart(&#39;real-time-chart&#39;);
createChart(&#39;temperature-chart&#39;);
createChart(&#39;humidity-chart&#39;);
createChart(&#39;distribution-chart&#39;);
createChart(&#39;precipitation-chart&#39;);
const uploadButton = document.getElementById(&#39;upload-button&#39;);
const detectButton = document.getElementById(&#39;detect-button&#39;);
const imageUpload = document.getElementById(&#39;image-upload&#39;);
const previewContainer = document.getElementById(&#39;preview-container&#39;);
const resultContainer = document.getElementById(&#39;result-container&#39;);
const detectionData = document.getElementById(&#39;detection-data&#39;);
const uploadArea = document.getElementById(&#39;upload-area&#39;);
let currentFile = null;
let isProcessing = false;
function handleFile(file) {
if (!file?.type.match(&#39;image.*&#39;)) { alert(&#39;请选择有效的图片文件&#39;); return false; }
if (isProcessing) return false;
isProcessing = true;
const reader = new FileReader();
reader.onload = (event) =&gt; {
previewContainer.innerHTML = `&lt;img src=&quot;${event.target.result}&quot; style=&quot;max-
width:100%;max-height:200px;&quot;&gt;`;
previewContainer.style.display = &#39;block&#39;;
uploadButton.textContent = &#39;重新选择图片&#39;;
detectButton.style.display = &#39;block&#39;;
detectButton.disabled = false;
currentFile = file;
isProcessing = false;
};
reader.readAsDataURL(file);
return true;
}
function processFileInput(files) { if (files &amp;&amp; files[0]) { imageUpload.files = files; return
handleFile(files[0]); } return false; }

uploadButton.addEventListener(&#39;click&#39;, () =&gt; { imageUpload.value = &#39;&#39;; imageUpload.click();
});
imageUpload.addEventListener(&#39;change&#39;, (e) =&gt; { processFileInput(e.target.files); });
uploadArea.addEventListener(&#39;dragover&#39;, (e) =&gt; { e.preventDefault();
uploadArea.style.border = &#39;2px dashed #00b4ff&#39;; });
uploadArea.addEventListener(&#39;dragleave&#39;, () =&gt; { uploadArea.style.border = &#39;2px dashed
rgba(0,180,255,0.3)&#39;; });
uploadArea.addEventListener(&#39;drop&#39;, (e) =&gt; { e.preventDefault(); uploadArea.style.border =
&#39;2px dashed rgba(0,180,255,0.3)&#39;; processFileInput(e.dataTransfer.files); });
detectButton.addEventListener(&#39;click&#39;, async () =&gt; {
if (!currentFile || isProcessing) return;
isProcessing = true;
detectButton.disabled = true;
detectButton.textContent = &#39;检测中...&#39;;
resultContainer.style.display = &#39;flex&#39;;
detectionData.innerHTML = &#39;&lt;div class=&quot;loading&quot;&gt;检测中...&lt;/div&gt;&#39;;
try {
const formData = new FormData();
formData.append(&#39;image&#39;, currentFile);
const response = await fetch(&#39;http://localhost:5050/api/detect&#39;, { method: &#39;POST&#39;, body:
formData });
const data = await response.json();
if (data.status === &#39;success&#39;) {
const detectionImage = document.getElementById(&#39;detection-image&#39;);
detectionImage.innerHTML = `&lt;img src=&quot;data:image/png;base64,${data.image}&quot;
style=&quot;max-width: 100%; height: auto;&quot;&gt;`;
const result = JSON.parse(data.result);
detectionData.innerHTML = `&lt;h3&gt;检测结果&lt;/h3&gt;&lt;p&gt;检测数量:
${result.count}&lt;/p&gt;&lt;p&gt;推理时间: ${result.inference_time.toFixed(2)}秒&lt;/p&gt;&lt;p&gt;模型:
${result.model}&lt;/p&gt;&lt;div class=&quot;detected-objects&quot;&gt;&lt;h4&gt;检测到的目标
:&lt;/h4&gt;${result.objects.map(obj =&gt; `&lt;div class=&quot;object-item&quot;&gt;&lt;span class=&quot;object-
class&quot;&gt;${obj.class}&lt;/span&gt;&lt;span class=&quot;object-score&quot;&gt;置信度: ${(obj.score *
100).toFixed(1)}%&lt;/span&gt;&lt;/div&gt;`).join(&#39;&#39;)}&lt;/div&gt;`;
} else { detectionData.innerHTML = `&lt;p style=&quot;color:#ff5555;&quot;&gt;检测失败:
${data.message || &#39;未知错误&#39;}&lt;/p&gt;`; }
} catch (error) { detectionData.innerHTML = `&lt;p style=&quot;color:#ff5555;&quot;&gt;网络错误:
${error.message}&lt;/p&gt;`; }
finally { detectButton.disabled = false; detectButton.textContent = &#39;开始检测&#39;;
isProcessing = false; }
});
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/api_test.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;UTF-8&quot;&gt;
&lt;title&gt;API测试页面&lt;/title&gt;
&lt;style&gt;
body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.section { margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
button { padding: 10px 15px; background-color: #4CAF50; color: white; border: none;
border-radius: 4px; cursor: pointer; margin-right: 10px; }
button:hover { background-color: #45a049; }

#imagePreview { max-width: 300px; margin-top: 10px; }
#results { margin-top: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;
white-space: pre-wrap; }
.loading { color: #666; font-style: italic; }
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;h1&gt;API测试页面&lt;/h1&gt;
&lt;div class=&quot;section&quot;&gt;
&lt;h2&gt;目标检测测试&lt;/h2&gt;
&lt;input type=&quot;file&quot; id=&quot;imageUpload&quot; accept=&quot;image/*&quot;&gt;
&lt;div style=&quot;margin: 10px 0;&quot;&gt;
&lt;label&gt;选择模型: &lt;/label&gt;
&lt;select id=&quot;modelSelect&quot;&gt;
&lt;option value=&quot;detr-resnet-50&quot;&gt;DETR-ResNet50 (快速)&lt;/option&gt;
&lt;option value=&quot;detr-resnet-101&quot;&gt;DETR-ResNet101 (标准)&lt;/option&gt;
&lt;option value=&quot;detr-resnet-101-dc5&quot; selected&gt;DETR-ResNet101-DC5 (高精度
)&lt;/option&gt;
&lt;/select&gt;
&lt;/div&gt;
&lt;button onclick=&quot;testDetect()&quot;&gt;测试目标检测&lt;/button&gt;
&lt;div id=&quot;imagePreviewContainer&quot;&gt;&lt;img id=&quot;imagePreview&quot; style=&quot;display:none;&quot;&gt;&lt;/div&gt;
&lt;div id=&quot;detectResults&quot; class=&quot;loading&quot;&gt;等待测试...&lt;/div&gt;
&lt;/div&gt;
&lt;div class=&quot;section&quot;&gt;
&lt;h2&gt;地理数据测试&lt;/h2&gt;
&lt;button onclick=&quot;testGeoData()&quot;&gt;测试地理数据&lt;/button&gt;
&lt;div id=&quot;geoResults&quot; class=&quot;loading&quot;&gt;等待测试...&lt;/div&gt;
&lt;/div&gt;
&lt;script&gt;
let currentImage = null;
document.getElementById(&#39;imageUpload&#39;).addEventListener(&#39;change&#39;, function(e) {
const file = e.target.files[0];
if (file) {
currentImage = file;
const reader = new FileReader();
reader.onload = function(event) {
const img = document.getElementById(&#39;imagePreview&#39;);
img.src = event.target.result; img.style.display = &#39;block&#39;;
};
reader.readAsDataURL(file);
}
});
async function testDetect() {
if (!currentImage) { alert(&#39;请先选择图片&#39;); return; }
const resultsDiv = document.getElementById(&#39;detectResults&#39;);
resultsDiv.innerHTML = &#39;&lt;span class=&quot;loading&quot;&gt;检测中...&lt;/span&gt;&#39;;
try {
const formData = new FormData();
formData.append(&#39;image&#39;, currentImage);
const model = document.getElementById(&#39;modelSelect&#39;).value;
const response = await fetch(`http://localhost:8080/api/detect?model=${model}`, {
method: &#39;POST&#39;, body: formData });
if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
const contentType = response.headers.get(&#39;content-type&#39;);
if (!contentType || !contentType.includes(&#39;application/json&#39;)) { throw new Error(&quot;Invalid
response format&quot;); }

const data = await response.json().catch(e =&gt; { throw new Error(`JSON解析错误:
${e.message}`); });
resultsDiv.innerHTML = `&lt;div style=&quot;display: flex;&quot;&gt;&lt;div style=&quot;flex: 1;&quot;&gt;&lt;strong&gt;检
测结果:&lt;/strong&gt;&lt;pre&gt;${JSON.stringify(data, null, 2)}&lt;/pre&gt;&lt;/div&gt;&lt;div style=&quot;flex: 1; margin-
left: 20px;&quot;&gt;&lt;strong&gt;结果图:&lt;/strong&gt;&lt;img id=&quot;resultImage&quot; style=&quot;max-width: 100%;&quot;
src=&quot;/api/result_image/${data.result_id}?t=${Date.now()}&quot;&gt;&lt;/div&gt;&lt;/div&gt;`;
} catch (error) { resultsDiv.innerHTML = `&lt;strong&gt;错误:&lt;/strong&gt; ${error.message}`; }
}
async function testGeoData() {
const resultsDiv = document.getElementById(&#39;geoResults&#39;);
resultsDiv.innerHTML = &#39;&lt;span class=&quot;loading&quot;&gt;获取中...&lt;/span&gt;&#39;;
try {
const response = await fetch(&#39;http://localhost:8080/api/geo&#39;);
const data = await response.json();
resultsDiv.innerHTML = `&lt;strong&gt;地理数据:&lt;/strong&gt;\n${JSON.stringify(data, null,
2)}`;
} catch (error) { resultsDiv.innerHTML = `&lt;strong&gt;错误:&lt;/strong&gt; ${error.message}`; }
}
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: config.py
import os
from dataclasses import dataclass
from typing import Dict, List
@dataclass
class DatabaseConfig:
database_url: str = &quot;visual_parts.db&quot;
pool_size: int = 5
max_overflow: int = 10
pool_timeout: int = 30
@dataclass
class ModelConfig:
model_name: str = &quot;facebook/detr-resnet-101-dc5&quot;
detection_threshold: float = 0.6
nms_threshold: float = 0.5
padding_ratio: float = 0.15
contrast_enhance: float = 2.0
sharpness_enhance: float = 1.5
@dataclass
class APIConfig:
host: str = &quot;0.0.0.0&quot;
port: int = 5050
debug: bool = False
cors_origins: List[str] = None
def __post_init__(self):
if self.cors_origins is None:
self.cors_origins = [&quot;*&quot;]
@dataclass
class AuthConfig:
security_questions: List[str] = None
auth_port: int = 5000

def __post_init__(self):
if self.security_questions is None:
self.security_questions = [
&quot;你的生日是什么时候？&quot;,
&quot;你母亲的名字是什么？&quot;,
&quot;你的第一所学校的名称是什么？&quot;,
&quot;你的宠物的名字是什么？&quot;,
&quot;你最喜欢的电影是什么？&quot;
]
@dataclass
class FrontendConfig:
map_data_url: str = &quot;https://geo.datav.aliyun.com/areas_v3/bound&quot;
province_pages: Dict[str, Dict] = None
def __post_init__(self):
if self.province_pages is None:
self.province_pages = {
&quot;北京市&quot;: {&quot;adcode&quot;: &quot;110000&quot;, &quot;area&quot;: &quot;16410&quot;, &quot;population&quot;: &quot;2189&quot;,
&quot;gdp&quot;: &quot;40269&quot;},
&quot;天津市&quot;: {&quot;adcode&quot;: &quot;120000&quot;, &quot;area&quot;: &quot;11966&quot;, &quot;population&quot;: &quot;1387&quot;,
&quot;gdp&quot;: &quot;14084&quot;},
&quot;河北省&quot;: {&quot;adcode&quot;: &quot;130000&quot;, &quot;area&quot;: &quot;188800&quot;, &quot;population&quot;: &quot;7592&quot;,
&quot;gdp&quot;: &quot;36207&quot;},
&quot;山西省&quot;: {&quot;adcode&quot;: &quot;140000&quot;, &quot;area&quot;: &quot;156000&quot;, &quot;population&quot;: &quot;3718&quot;,
&quot;gdp&quot;: &quot;17652&quot;},
&quot;内蒙古自治区&quot;: {&quot;adcode&quot;: &quot;150000&quot;, &quot;area&quot;: &quot;1183000&quot;, &quot;population&quot;:
&quot;2534&quot;, &quot;gdp&quot;: &quot;17213&quot;},
&quot;辽宁省&quot;: {&quot;adcode&quot;: &quot;210000&quot;, &quot;area&quot;: &quot;148000&quot;, &quot;population&quot;: &quot;4359&quot;,
&quot;gdp&quot;: &quot;25115&quot;},
&quot;吉林省&quot;: {&quot;adcode&quot;: &quot;220000&quot;, &quot;area&quot;: &quot;187400&quot;, &quot;population&quot;: &quot;2691&quot;,
&quot;gdp&quot;: &quot;12311&quot;},
&quot;黑龙江省&quot;: {&quot;adcode&quot;: &quot;230000&quot;, &quot;area&quot;: &quot;473000&quot;, &quot;population&quot;: &quot;3813&quot;,
&quot;gdp&quot;: &quot;13699&quot;},
&quot;上海市&quot;: {&quot;adcode&quot;: &quot;310000&quot;, &quot;area&quot;: &quot;6340&quot;, &quot;population&quot;: &quot;2428&quot;,
&quot;gdp&quot;: &quot;38701&quot;},
&quot;江苏省&quot;: {&quot;adcode&quot;: &quot;320000&quot;, &quot;area&quot;: &quot;102600&quot;, &quot;population&quot;: &quot;8051&quot;,
&quot;gdp&quot;: &quot;102719&quot;},
&quot;浙江省&quot;: {&quot;adcode&quot;: &quot;330000&quot;, &quot;area&quot;: &quot;101800&quot;, &quot;population&quot;: &quot;5850&quot;,
&quot;gdp&quot;: &quot;64613&quot;},
&quot;安徽省&quot;: {&quot;adcode&quot;: &quot;340000&quot;, &quot;area&quot;: &quot;140100&quot;, &quot;population&quot;: &quot;6324&quot;,
&quot;gdp&quot;: &quot;38681&quot;},
&quot;福建省&quot;: {&quot;adcode&quot;: &quot;350000&quot;, &quot;area&quot;: &quot;121400&quot;, &quot;population&quot;: &quot;3973&quot;,
&quot;gdp&quot;: &quot;43904&quot;},
&quot;江西省&quot;: {&quot;adcode&quot;: &quot;360000&quot;, &quot;area&quot;: &quot;166900&quot;, &quot;population&quot;: &quot;4648&quot;,
&quot;gdp&quot;: &quot;25692&quot;},
&quot;山东省&quot;: {&quot;adcode&quot;: &quot;370000&quot;, &quot;area&quot;: &quot;157100&quot;, &quot;population&quot;: &quot;10153&quot;,
&quot;gdp&quot;: &quot;73129&quot;},
&quot;河南省&quot;: {&quot;adcode&quot;: &quot;410000&quot;, &quot;area&quot;: &quot;167000&quot;, &quot;population&quot;: &quot;9883&quot;,
&quot;gdp&quot;: &quot;54259&quot;},
&quot;湖北省&quot;: {&quot;adcode&quot;: &quot;420000&quot;, &quot;area&quot;: &quot;185900&quot;, &quot;population&quot;: &quot;5927&quot;,
&quot;gdp&quot;: &quot;45828&quot;},
&quot;湖南省&quot;: {&quot;adcode&quot;: &quot;430000&quot;, &quot;area&quot;: &quot;211800&quot;, &quot;population&quot;: &quot;6919&quot;,
&quot;gdp&quot;: &quot;39752&quot;},
&quot;广东省&quot;: {&quot;adcode&quot;: &quot;440000&quot;, &quot;area&quot;: &quot;179800&quot;, &quot;population&quot;: &quot;11521&quot;,
&quot;gdp&quot;: &quot;110761&quot;},
&quot;广西壮族自治区&quot;: {&quot;adcode&quot;: &quot;450000&quot;, &quot;area&quot;: &quot;237600&quot;, &quot;population&quot;:
&quot;4926&quot;, &quot;gdp&quot;: &quot;22157&quot;},

&quot;海南省&quot;: {&quot;adcode&quot;: &quot;460000&quot;, &quot;area&quot;: &quot;35400&quot;, &quot;population&quot;: &quot;1008&quot;,
&quot;gdp&quot;: &quot;5532&quot;},
&quot;重庆市&quot;: {&quot;adcode&quot;: &quot;500000&quot;, &quot;area&quot;: &quot;82400&quot;, &quot;population&quot;: &quot;3124&quot;,
&quot;gdp&quot;: &quot;25003&quot;},
&quot;四川省&quot;: {&quot;adcode&quot;: &quot;510000&quot;, &quot;area&quot;: &quot;486000&quot;, &quot;population&quot;: &quot;8375&quot;,
&quot;gdp&quot;: &quot;46616&quot;},
&quot;贵州省&quot;: {&quot;adcode&quot;: &quot;520000&quot;, &quot;area&quot;: &quot;176000&quot;, &quot;population&quot;: &quot;3856&quot;,
&quot;gdp&quot;: &quot;17827&quot;},
&quot;云南省&quot;: {&quot;adcode&quot;: &quot;530000&quot;, &quot;area&quot;: &quot;394000&quot;, &quot;population&quot;: &quot;4830&quot;,
&quot;gdp&quot;: &quot;24522&quot;},
&quot;西藏自治区&quot;: {&quot;adcode&quot;: &quot;540000&quot;, &quot;area&quot;: &quot;1228000&quot;, &quot;population&quot;:
&quot;366&quot;, &quot;gdp&quot;: &quot;1903&quot;},
&quot;陕西省&quot;: {&quot;adcode&quot;: &quot;610000&quot;, &quot;area&quot;: &quot;205600&quot;, &quot;population&quot;: &quot;3953&quot;,
&quot;gdp&quot;: &quot;25793&quot;},
&quot;甘肃省&quot;: {&quot;adcode&quot;: &quot;620000&quot;, &quot;area&quot;: &quot;454000&quot;, &quot;population&quot;: &quot;2637&quot;,
&quot;gdp&quot;: &quot;9017&quot;},
&quot;青海省&quot;: {&quot;adcode&quot;: &quot;630000&quot;, &quot;area&quot;: &quot;722000&quot;, &quot;population&quot;: &quot;603&quot;,
&quot;gdp&quot;: &quot;3010&quot;},
&quot;宁夏回族自治区&quot;: {&quot;adcode&quot;: &quot;640000&quot;, &quot;area&quot;: &quot;66400&quot;, &quot;population&quot;:
&quot;688&quot;, &quot;gdp&quot;: &quot;3921&quot;},
&quot;新疆维吾尔自治区&quot;: {&quot;adcode&quot;: &quot;650000&quot;, &quot;area&quot;: &quot;1660000&quot;,
&quot;population&quot;: &quot;2523&quot;, &quot;gdp&quot;: &quot;13798&quot;},
&quot;台湾省&quot;: {&quot;adcode&quot;: &quot;710000&quot;, &quot;area&quot;: &quot;36100&quot;, &quot;population&quot;: &quot;2359&quot;,
&quot;gdp&quot;: &quot;41400&quot;},
&quot;香港特别行政区&quot;: {&quot;adcode&quot;: &quot;810000&quot;, &quot;area&quot;: &quot;1106&quot;, &quot;population&quot;:
&quot;741&quot;, &quot;gdp&quot;: &quot;24103&quot;},
&quot;澳门特别行政区&quot;: {&quot;adcode&quot;: &quot;820000&quot;, &quot;area&quot;: &quot;33&quot;, &quot;population&quot;: &quot;68&quot;,
&quot;gdp&quot;: &quot;1944&quot;}
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
if os.getenv(&#39;DATABASE_URL&#39;):
config.database.database_url = os.getenv(&#39;DATABASE_URL&#39;)
if os.getenv(&#39;API_HOST&#39;):
config.api.host = os.getenv(&#39;API_HOST&#39;)
if os.getenv(&#39;API_PORT&#39;):
config.api.port = int(os.getenv(&#39;API_PORT&#39;))
if os.getenv(&#39;API_DEBUG&#39;):
config.api.debug = os.getenv(&#39;API_DEBUG&#39;).lower() == &#39;true&#39;
if os.getenv(&#39;AUTH_PORT&#39;):
config.auth.auth_port = int(os.getenv(&#39;AUTH_PORT&#39;))
return config
config = Config.from_env()
# 文件名: dev-proxy.js
const express = require(&#39;express&#39;);

const { createProxyMiddleware } = require(&#39;http-proxy-middleware&#39;);
const cors = require(&#39;cors&#39;);
const path = require(&#39;path&#39;);
const app = express();
const PORT = process.env.PORT || 9000;
app.use(cors());
app.options(/^\/api\/.*$/, (req, res) =&gt; res.sendStatus(200));
app.use(&#39;/api&#39;, createProxyMiddleware({
target: &#39;http://localhost:8000&#39;,
changeOrigin: true,
logLevel: &#39;debug&#39;,
cookieDomainRewrite: false,
pathRewrite: (path) =&gt; {
if (path.startsWith(&#39;/&#39;)) return &#39;/api&#39; + path;
return &#39;/api/&#39; + path;
},
onProxyReq(proxyReq, req, res) {
console.log(&#39;→ proxy&#39;, req.method, req.originalUrl, &#39;=&gt;&#39;, proxyReq.getHeader(&#39;host&#39;),
proxyReq.path);
},
onProxyRes(proxyRes, req, res) {
console.log(&#39;← proxy&#39;, req.method, req.originalUrl, &#39;status&#39;, proxyRes.statusCode);
}
}));
app.use(express.static(path.join(__dirname)));
app.listen(PORT, () =&gt; console.log(`Dev server running at http://localhost:${PORT}`));
# 文件名: visualheader/simple_register.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;注册 - 空天地一体化可视化平台&lt;/title&gt;
&lt;style&gt;
body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 0; display:
flex; justify-content: center; align-items: center; height: 100vh; }
.register-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0
2px 10px rgba(0,0,0,0.1); width: 350px; }
.register-container h2 { margin-top: 0; color: #333; text-align: center; }
.form-group { margin-bottom: 15px; }
.form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
.form-group input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;
box-sizing: border-box; }
.form-actions { display: flex; justify-content: space-between; margin-top: 20px; }
.btn { padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-weight:
bold; }
.btn-primary { background: #1890ff; color: white; }
.btn-default { background: #f0f0f0; color: #333; }
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;div class=&quot;register-container&quot;&gt;

&lt;h2&gt;用户注册&lt;/h2&gt;
&lt;div class=&quot;form-group&quot;&gt;&lt;label for=&quot;username&quot;&gt;用户名&lt;/label&gt;&lt;input type=&quot;text&quot;
id=&quot;username&quot; placeholder=&quot;请输入用户名&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;form-group&quot;&gt;&lt;label for=&quot;password&quot;&gt;密码&lt;/label&gt;&lt;input type=&quot;password&quot;
id=&quot;password&quot; placeholder=&quot;请输入密码&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;form-group&quot;&gt;&lt;label for=&quot;confirm-password&quot;&gt;确认密码&lt;/label&gt;&lt;input
type=&quot;password&quot; id=&quot;confirm-password&quot; placeholder=&quot;请再次输入密码&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;form-actions&quot;&gt;&lt;button id=&quot;cancel-btn&quot; class=&quot;btn btn-default&quot;&gt;取消
&lt;/button&gt;&lt;button id=&quot;register-btn&quot; class=&quot;btn btn-primary&quot;&gt;注册&lt;/button&gt;&lt;/div&gt;
&lt;/div&gt;
&lt;script&gt;
document.addEventListener(&#39;DOMContentLoaded&#39;, function() {
const registerBtn = document.getElementById(&#39;register-btn&#39;);
const cancelBtn = document.getElementById(&#39;cancel-btn&#39;);
registerBtn.addEventListener(&#39;click&#39;, function() {
const username = document.getElementById(&#39;username&#39;).value;
const password = document.getElementById(&#39;password&#39;).value;
const confirmPassword = document.getElementById(&#39;confirm-password&#39;).value;
if (!username || !password || !confirmPassword) { alert(&#39;请填写所有字段&#39;); return; }
if (password !== confirmPassword) { alert(&#39;两次输入的密码不一致&#39;); return; }
alert(&#39;注册成功(演示模式)&#39;);
});
cancelBtn.addEventListener(&#39;click&#39;, function() { window.history.back(); });
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/province_template.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;{{province}}科技地图&lt;/title&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js&quot;&gt;&lt;/script&gt;
&lt;style&gt;
body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
#province-map { width: 100%; height: 80vh; }
.back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background:
#1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100;
}
.province-info { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-
radius: 8px; }
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;button class=&quot;back-button&quot; onclick=&quot;window.location.href=&#39;tech_map.html&#39;&quot;&gt;← 返回全国
&lt;/button&gt;
&lt;div id=&quot;province-map&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;province-info&quot;&gt;
&lt;h2&gt;{{province}}信息&lt;/h2&gt;
&lt;p&gt;面积：{{area}}平方公里&lt;/p&gt;
&lt;p&gt;人口：{{population}}万人&lt;/p&gt;
&lt;p&gt;GDP：{{gdp}}亿元&lt;/p&gt;
&lt;/div&gt;
&lt;script&gt;
const mapChart = echarts.init(document.getElementById(&#39;province-map&#39;));
const provinceName = &#39;{{province}}&#39;;

$.get(`https://geo.datav.aliyun.com/areas_v3/bound/{{adcode}}_full.json`, function(geoJson)
{
echarts.registerMap(provinceName, geoJson);
mapChart.setOption({
backgroundColor: &#39;#0f1621&#39;,
title: { text: provinceName, left: &#39;center&#39;, textStyle: { color: &#39;#fff&#39; } },
geo: { map: provinceName, roam: true, itemStyle: { areaColor: &#39;#1a2b5a&#39;, borderColor:
&#39;#0a2dae&#39; }, emphasis: { itemStyle: { areaColor: &#39;#2a91d8&#39; } } }
});
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: visualheader/wetland.html
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
&lt;meta charset=&quot;utf-8&quot;&gt;
&lt;title&gt;郑州黄河湿地自然保护区&lt;/title&gt;
&lt;script src=&quot;https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js&quot;&gt;&lt;/script&gt;
&lt;style&gt;
body { margin: 0; background-color: #0f1621; color: #fff; font-family: Arial, sans-serif; }
#map-container { width: 100%; height: 85vh; }
.info-panel { padding: 20px; background: rgba(10,30,60,0.8); margin: 20px; border-radius:
8px; }
.back-button { position: fixed; top: 20px; left: 20px; padding: 8px 16px; background:
#1a2b5a; color: #fff; border: 1px solid #0a2dae; border-radius: 4px; cursor: pointer; z-index: 100;
}
&lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
&lt;button class=&quot;back-button&quot; onclick=&quot;window.location.href=&#39;henan.html&#39;&quot;&gt;← 返回河南省
&lt;/button&gt;
&lt;div id=&quot;map-container&quot;&gt;&lt;/div&gt;
&lt;div class=&quot;info-panel&quot;&gt;
&lt;h2&gt;郑州黄河湿地自然保护区&lt;/h2&gt;
&lt;p&gt;位置：河南省郑州市&lt;/p&gt;
&lt;p&gt;面积：约36000公顷&lt;/p&gt;
&lt;p&gt;特点：国家重要湿地,鸟类迁徙重要通道&lt;/p&gt;
&lt;/div&gt;
&lt;script&gt;
const mapChart = echarts.init(document.getElementById(&#39;map-container&#39;));
const mapOption = {
backgroundColor: &#39;#0f1621&#39;,
title: { text: &#39;郑州黄河湿地自然保护区&#39;, left: &#39;center&#39;, textStyle: { color: &#39;#fff&#39; } },
geo: { map: &#39;henan&#39;, roam: true, itemStyle: { areaColor: &#39;#1a2b5a&#39;, borderColor: &#39;#0a2dae&#39;
}, emphasis: { itemStyle: { areaColor: &#39;#2a91d8&#39; } } }
};
$.get(&#39;https://geo.datav.aliyun.com/areas_v3/bound/410000_full.json&#39;, function(geoJson) {
echarts.registerMap(&#39;henan&#39;, geoJson);
mapChart.setOption(mapOption);
});
&lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
# 文件名: Backend/betest.py
from database import Database
import requests
def test():
db = Database()
if db.verify_user(&#39;admin&#39;, &#39;******&#39;):
print(&#39;登录成功&#39;)
else:
print(&#39;登录失败&#39;)
test()