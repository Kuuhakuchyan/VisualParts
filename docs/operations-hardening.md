# 微境探界平台工程补强清单

## 路由关系

- `/`：微境探界公开主页，展示项目定位、团队与平台入口。
- `/monitor`：IoT 实时监测工作台。
- `/portal`：兼容旧入口，跳转到公开主页。
- `/decision/`：Cesium 三维微气候决策平台。
- `/grafana/`：Grafana 运维看板。
- `/author/`：Kuuhakuchyan 作者主页。

## 高并发与可靠性

- API 通过 `WEB_CONCURRENCY` 启动多 worker，数据库连接池按 worker 数量控制，避免连接数被放大。
- Nginx 对普通页面、API、写入接口分别设置 `limit_req`。
- PostgreSQL 与 API 添加 Docker healthcheck。
- Cesium 瓦片走同源代理，降低浏览器跨域失败和第三方服务抖动对前端的影响。

## 安全与反逆向

- 前端不放真实 token；Cesium Ion token 只允许通过 `VITE_CESIUM_ION_TOKEN` 注入。
- 生产构建不输出 source map；Nginx 拦截 `.map`、`.env`、`.sql`、`.bak` 等敏感或调试文件。
- Nginx 增加 `nosniff`、`frame-ancestors`、`object-src 'none'`、`Permissions-Policy` 等基础安全头。
- 反逆向的重点是“不把秘密发到前端”，代码混淆只作为次要手段。

## MQTT 暴露面

- `1883` 保留给设备上报，必须启用账号密码。
- `8081` 仅绑定 `127.0.0.1`，不再公网暴露。
- `9001` WebSocket 仅绑定 `127.0.0.1`，需要时通过 Nginx `/mqtt` 代理。
- Mosquitto 限制连接数、单消息大小、队列和 inflight 数，减少异常设备或攻击流量影响。

## 备份

使用 `scripts/backup_postgres.sh`：

```sh
BACKUP_DIR=/root/weather_backups RETENTION_DAYS=14 ./scripts/backup_postgres.sh
```

建议后续配 systemd timer 或 crontab，每天至少备份一次，并定期做恢复演练。
