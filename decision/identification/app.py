from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import sys
import uuid
import base64
from datetime import datetime
from werkzeug.utils import secure_filename

# 将项目根目录添加到Python路径
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from identification.model.transformer import detect_objects

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# 配置
UPLOAD_FOLDER = 'identification/result'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/detect', methods=['POST'])
def detect():
    """对象检测API端点"""
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    
    image_file = request.files['image']
    if image_file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not allowed_file(image_file.filename):
        return jsonify({'error': 'Invalid file type'}), 400
    
    try:
        # 读取图片
        image_data = image_file.read()
        
        # Generate unique filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"detection_{timestamp}_{unique_id}.jpg"
        save_path = os.path.join(UPLOAD_FOLDER, filename)
        
        # Call detection function with save option
        result_json = detect_objects(image_data, return_type='json')
        result_image = detect_objects(image_data, return_type='image')
        
        # 保存结果
        with open(save_path, 'wb') as f:
            f.write(base64.b64decode(result_image))
        
        # 返回JSON和图像路径
        response = {
            'success': True,
            'result': result_json,
            'image_path': save_path,
            'image_url': f'/result/{filename}'
        }
        return jsonify(response), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/result/<filename>')
def serve_result(filename):
    """提供检测结果图片"""
    return send_file(os.path.join(UPLOAD_FOLDER, filename))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
