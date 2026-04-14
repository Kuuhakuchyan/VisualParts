from flask import Flask, request, jsonify
from database import Database
import json

app = Flask(__name__)
db = Database()

SECURITY_QUESTIONS = [
    "你的生日是什么时候？",
    "你母亲的名字是什么？",
    "你的第一所学校的名称是什么？",
    "你的宠物的名字是什么？",
    "你最喜欢的电影是什么？"
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
