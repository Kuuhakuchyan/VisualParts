import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

def init_db():
    conn = sqlite3.connect('visual_parts.db')
    cursor = conn.cursor()
    
    # 创建用户表
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        security_question TEXT NOT NULL,
        security_answer TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # 创建地理数据表
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS geo_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        coordinates TEXT NOT NULL,
        properties TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
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
        self.cursor.execute(
            'SELECT password_hash FROM users WHERE username = ?', 
            (username,)
        )
        result = self.cursor.fetchone()
        if result and check_password_hash(result[0], password):
            return True
        return False
    
    def get_security_question(self, username):
        self.cursor.execute(
            'SELECT security_question FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def verify_security_answer(self, username, answer):
        self.cursor.execute(
            'SELECT security_answer FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result and result[0] == answer
    
    def reset_password(self, username, new_password):
        self.cursor.execute(
            'UPDATE users SET password_hash = ? WHERE username = ?',
            (generate_password_hash(new_password), username)
        )
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def add_geo_data(self, user_id, data_type, coordinates, properties=None):
        self.cursor.execute(
            'INSERT INTO geo_data (user_id, data_type, coordinates, properties) VALUES (?, ?, ?, ?)',
            (user_id, data_type, coordinates, properties)
        )
        self.conn.commit()
        return self.cursor.lastrowid
    
    def get_user_id(self, username):
        self.cursor.execute(
            'SELECT id FROM users WHERE username = ?',
            (username,)
        )
        result = self.cursor.fetchone()
        return result[0] if result else None
    
    def __del__(self):
        self.conn.close()

# 初始化数据库
init_db()
