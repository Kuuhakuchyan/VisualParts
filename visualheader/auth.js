class AuthManager {
    constructor() {
        this.currentUser = localStorage.getItem('username') || null;
    }

    // 登录：使用统一 API 客户端
    async login(username, password) {
        try {
            const response = await window.API.login(username, password);
            const token = response.data?.token;
            if (!token) {
                // 如果后端返回 success 但无 token，则提示后端未按文档返回
                const msg = response.data?.message || '登录返回未包含 token';
                return { success: false, message: msg };
            }
            localStorage.setItem('userToken', token);
            localStorage.setItem('username', username);
            this.currentUser = username;
            await this.fetchProfile(); // 预取积分信息
            this.updateAuthUI();
            return { success: true };
        } catch (error) {
            console.error('登录失败:', error);
            const message = error?.response?.data?.error || error.message || '网络错误';
            return { success: false, message };
        }
    }

    // 兼容：当前后端无注册接口，给出提示
    async register() {
        return { success: false, message: '当前接口未提供注册功能，请联系管理员开通' };
    }

    async fetchProfile() {
        if (!localStorage.getItem('userToken')) return null;
        try {
            const res = await window.API.getProfile();
            const profile = res.data;
            // 可按需存储更多信息
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
            // 已登录状态
            authStatus.innerHTML = `<span>欢迎, ${this.currentUser}</span>`;
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            logoutBtn.style.display = 'block';
        } else {
            // 未登录状态
            authStatus.innerHTML = '<span>未登录</span>' +
                '<button id="login-btn" class="auth-btn">登录</button>' +
                '<button id="register-btn" class="auth-btn">注册</button>';
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            logoutBtn.style.display = 'none';
        }
    }
}

// 导出类定义
export default AuthManager;
