/**
 * js/api.js
 * 负责统一管理所有后端接口请求
 */

// 基础配置：
// 1) 优先读取全局/本地覆盖
// 2) 若在本地开发（localhost:8080）且无覆盖，使用相对路径 ''，这样调用 '/api/xxx' 走同源代理，不会重复 /api
// 3) 其他环境默认直连后端
const OVERRIDE_BASE = window.API_BASE_URL || localStorage.getItem('API_BASE_URL');
const isLocalhost = window.location.hostname === 'localhost';

// 默认直接指向后端，避免本地代理将 /api/login/ 重写成 /login/ 产生 404。
// 如需再次使用本地代理，可在控制台执行：
//   localStorage.setItem('API_BASE_URL', '');
//   location.reload();
const BASE_URL = OVERRIDE_BASE !== null && OVERRIDE_BASE !== undefined
    ? OVERRIDE_BASE
    : 'http://8.130.139.184:8000';

// 创建 axios 实例
const request = axios.create({
    baseURL: BASE_URL,
    timeout: 10000
});

// 请求拦截器：自动添加 Token 
request.interceptors.request.use(config => {
    const token = localStorage.getItem('userToken');
    if (token) {
        // 注意：文档要求格式为 "Token <你的token值>"
        config.headers['Authorization'] = `Token ${token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

// 响应拦截器：统一处理错误
request.interceptors.response.use(
    response => response,
    error => {
        if (error.response && error.response.status === 401) {
            // Token 失效时清理本地缓存，方便触发重新登录
            localStorage.removeItem('userToken');
            localStorage.removeItem('username');
            console.warn('Token 已失效，请重新登录');
        }
        return Promise.reject(error);
    }
);

// 导出 API 方法对象
const API = {
    // 1. 登录接口 
    login: async (username, password) => {
        // 使用 application/x-www-form-urlencoded 避免预检 OPTIONS 导致 405
        const form = new URLSearchParams();
        form.append('username', username);
        form.append('password', password);

        // 强制使用带尾斜杠的规范路径，避免被上游重写成 /login 导致 404
        return request.post('/api/login/', form, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
    },
 
    // 2. 获取个人信息 (含积分) 
    getProfile: () => {
        return request.get('/api/profiles/me/');
    },

    // 3. 获取观测记录 (地图打点) 
    getObservations: () => {
        return request.get('/api/observations/');
    },

    // 4. 上传观测记录 (赚积分) 
    uploadObservation: (file, data) => {
        const formData = new FormData();
        // 必填项
        formData.append('image', file);
        formData.append('species', data.species || 1); // 默认为1或由前端指定
        formData.append('count', data.count || 1);
        formData.append('observation_time', data.observation_time || data.date || new Date().toISOString().split('T')[0]);
        
        // 选填项
        if (data.description) formData.append('description', data.description);
        if (data.lat) formData.append('lat', data.lat);
        if (data.lng) formData.append('lng', data.lng);
        if (data.zone) formData.append('zone', data.zone); // 关联的点位ID

        return request.post('/api/observations/', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },

    // 5. 获取商品列表
    getProducts: () => {
        return request.get('/api/products/');
    },

    // 6. 兑换商品
    redeemProduct: (productId) => {
        return request.post(`/api/products/${productId}/redeem/`);
    },

    // 7. 获取固定监测点位
    getZones: () => {
        return request.get('/api/zones/');
    },

    // 8. 获取监测样线 (路线)
    getTransects: () => {
        return request.get('/api/transects/');
    }
};

// 挂载到 window 对象，方便在没有模块化环境的 HTML 中直接使用
window.API = API;