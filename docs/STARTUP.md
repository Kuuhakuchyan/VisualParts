# VisualParts 城市微环境决策支持系统

## 项目简介

城市微环境决策支持系统，基于 Cesium 3D 可视化前端 + FastAPI 后端。

## 环境要求

- Node.js >= 18
- Python >= 3.10

## 安装步骤

### 1. 安装前端依赖

```bash
cd g:\VIsual parts
npm install
```

### 2. 安装后端依赖

```bash
cd g:\VIsual parts\backend
pip install -r requirements.txt
```

## 启动服务

### 方式一：同时启动前端和后端

需要打开**两个**终端窗口：

**终端 1 - 启动后端（端口 3000）**

```bash
cd g:\VIsual parts\backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 3000
```

**终端 2 - 启动前端（端口 5173）**

```bash
cd g:\VIsual parts
npm run dev
```

### 方式二：仅启动前端（生产模式，已编译）

```bash
cd g:\VIsual parts
npm run preview
```

前端会连接后端 API（需要后端单独运行）。

## 访问地址

- 前端界面：http://localhost:5173
- 后端 API：http://localhost:3000
- API 文档：http://localhost:3000/docs

## 项目结构

```
g:\VIsual parts\
├── src/                  # Cesium 前端源码
├── frontend/             # 前端模块
├── backend/             # FastAPI 后端
│   ├── main.py          # 主入口
│   ├── routers/         # API 路由
│   ├── database.py      # 数据库层
│   └── agi/             # AI 推理模块
├── dist/                # 编译输出
└── docs/                # 文档
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run preview` | 预览生产版本 |
| `python -m uvicorn main:app --reload` | 启动后端（开发模式）|
