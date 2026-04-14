import AuthManager from './auth.js';

// 创建AuthManager实例
const authManager = new AuthManager();

// 绑定UI事件
document.addEventListener('DOMContentLoaded', () => {
    // 主页面注册按钮点击 - 显示独立注册表单
    document.getElementById('register-btn')?.addEventListener('click', () => {
        document.getElementById('popup-register-form').style.display = 'flex';
        document.getElementById('popup-reg-username').focus();
    });

    // 独立注册表单取消按钮
    document.getElementById('popup-cancel-register')?.addEventListener('click', () => {
        document.getElementById('popup-register-form').style.display = 'none';
    });

    // 菜单注册链接点击 - 显示菜单注册表单
    document.getElementById('menu-register-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerForm.querySelector('#register-username').focus();
    });

    // 菜单中的注册按钮
    document.querySelector('[data-target="register-form"]')?.addEventListener('click', () => {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerForm.querySelector('#register-username').focus();
    });

    // 菜单中的登录按钮
    document.querySelector('[data-target="login-form"]')?.addEventListener('click', () => {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        loginForm.querySelector('#login-username').focus();
    });

    // 提交注册
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

    // 登出按钮
    document.getElementById('do-logout')?.addEventListener('click', () => {
        authManager.logout();
    });

    // 初始化UI
    authManager.updateAuthUI();
});
