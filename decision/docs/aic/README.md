# AIC 匿名热风险原型

独立入口 `/decision/aic/`，独立API前缀 `/api/weather/aic/`。沿用现有决策服务与天气代理，不调用空间Mock、随机置信度、示例设备状态或原AGI推演器。原有页面及数据库保留。

## 已实现的边界

当前网格与2024-06-12真实历史再分析天气分开，历史案例取当日气温最高的有效小时。每条观测包含上游原始响应、规范化JSON哈希、来源URL、请求坐标、返回网格、单位、北京时间和质量说明。质量校验是格式/范围校验，不代表现场校准。历史天气不冒充校园实测。

环境方法为NOAA/NWS两阶段Heat Index，含低湿/高湿修正，摄氏温度先转华氏计算，分级后显示四舍五入数值。保守运行范围为气温80至112°F，计算热指数不超过参考图表上限137°F，超过范围不外推；低于80°F不输出高温分级。分类阈值80/90/103/125°F采用连续区间。本原型仅参考阴凉、轻风条件，不能用公开网格准确代表具体日晒位置，不输出实测WBGT。活动/时长不改变热指数。

规则、观测ID、原始响应哈希、知识库版本、检索状态、降级原因和报告摘要随报告输出。报告JSON可回算。PDF使用浏览器打印；报告摘要是规范化JSON的SHA-256，不是数字签名。症状、报告不在服务端长期持久化，数据快照单独存储。AI开启后发送枚举场景和审核条款到DeepSeek，不发送姓名、病史或IP。

## 本地运行

在decision目录使用Python 3.10以上版本，安装backend/requirements.txt。开发时：

```powershell
$env:AIC_SOURCE_MANIFEST="G:/Working/大创/_git_publish/VisualParts-weather/decision/output/aic/sources/sources.json"
../.venv-aic/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 3000
npm.cmd run dev -- --host 127.0.0.1 --port 5192
```

开发地址 `/aic/index.html`。Vite开发服务器的目录回退可能返回原决策页，须带index.html。构建后public/aic整体复制至dist/aic，Nginx的目录index会让公开地址 `/decision/aic/` 正常访问。

## 来源存档与医师审核

以下命令均在decision目录执行，Python可替换为服务端虚拟环境解释器：

```text
python -m backend.aic.manage harvest --output output/aic/sources
python -m backend.aic.manage review-export --output output/aic/review-private/review-bundle.json
python -m backend.aic.manage review-import --input 已审核文件.json --output aic_state/review-private/reviews.json
```

采集原始HTML和纯文本，核对每条原文是否存在，记录内容SHA-256、抓取时间、响应元数据。设置AIC_SOURCE_MANIFEST指向sources.json。初始5条均为待审草案；不会自动批准。review-export包含完整原文、中文草案、适用条件、来源及内容哈希，protocol项绑定risk.py完整规则版本。执业医师应核查热指数表述、红旗扩展、急救号码本地化及条款场景。审核者、资格核对、时间与真实签署记录仅保留私密目录。

启用条款须：原文快照核验、内容哈希和来源哈希匹配、真实审核者及审核时间、资格核对和approved状态；协议规则也须批准。改动条款、来源版本或risk.py会使旧批准失效。程序只能校验记录完整性，无法替代核验真实医师资质和签署原件。禁止把测试中虚构的审核者标记用于生产。

## DeepSeek

私密环境变量为AIC_DEEPSEEK_API_KEY，仅新的匿名证据编排器读取；不设置旧模块的DEEPSEEK_API_KEY。默认deepseek-chat，不称DeepSeek V4或AGI医疗模型。model-smoke运行非医学连通性测试：

```text
python -m backend.aic.manage model-smoke --output output/aic/model-smoke.json
```

真实模型只在审核与检索通过后调用，每进程每分钟最多6次，最多2个并发；仅允许返回提供的建议ID数组。未知ID、重复、自由文本、超时、服务错误均退回已审核条款。最终建议为审核原文，AI负责选择和编排。该限制保证引用与输出的一致性，不声称自由文本医学推理。未审核时功能锁定，不能拿连通性测试冒充医学RAG验证。

## 现场观测接入

离线导入，不公开写接口。输入含device_id、point_id、location、observed_at（带时区）、temperature_c、relative_humidity_pct、shade_conditions、comparison_instrument、calibration_note、original_record_id、raw_file、quality_reviewer。原始文件保存在私密台账，文件哈希写入观测；公开标识必须匿名，不包含学校、姓名或仪器管理员身份。

```text
python -m backend.aic.manage field-import --input 私密测点记录.json --output output/aic/import.json
```

该命令输出观测ID，通过评估API的observation_id使用。近期离线的设备不会被标为在线；没有原始文件、对照或偏差说明则不能导入为核验观测。一次采集仅说明对应位置时段。需要长期连续监测时另行建立采集链与审核流程。

## 评测与验收

```text
python -m unittest backend.aic.test_aic -v
python -m backend.aic.manage scenarios --output docs/aic/evaluation-scenarios.json
python -m backend.aic.manage evaluate --input 已标注场景.json --output output/aic/clinician-evaluation.json
```

24个合成测试场景供医师标注。软件测试不等于医生标注或临床验证。未标注场景不计分，召回和症状准确率保持null。比较Top3检索、逐条来源支持，以及固定次序的审核条款基线与检索/AI编排结果，由实际医师评分针对性、可执行性和安全性，不预写提升。baseline保留适用条件过滤，固定按ID顺序，不使用关键词排序。

生产设置参考service-override.conf。私密密钥文件/etc/microclimate-aic.env须0600，审核目录不可位于web根目录。部署前备份后端及站点，测试通过再替换，原型阶段保持review_pending。除文件中的实际人工审核外，仍须完成成果授权、现场台账（如宣称实测）、报名缴费、材料制作与正式提交回执。
