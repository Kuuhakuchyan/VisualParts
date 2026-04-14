const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;
app.use(cors()); // 给静态文件加 CORS 头，方便本地调试

// 预检直接放行（用正则避免 path-to-regexp 通配符报错）
app.options(/^\/api\/.*$/, (req, res) => res.sendStatus(200));

// 代理 API 到后端
app.use('/api', createProxyMiddleware({
  target: 'http://8.130.139.184:8000',
  changeOrigin: true,
  logLevel: 'debug',
  cookieDomainRewrite: false,
  /**
   * Express 在挂载点 '/api' 之后会把前缀剥掉，req.url 变成 '/login/'。
   * 为了让后端收到完整的 '/api/login/'，这里把 '/api' 前缀补回去。
   */
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

// 静态文件服务
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => console.log(`Dev server running at http://localhost:${PORT}`));