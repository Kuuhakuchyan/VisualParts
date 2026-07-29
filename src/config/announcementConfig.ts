import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题
	title: "公告",

	// 公告内容
	content: "作者主页正在随项目迭代更新，当前已接入微气候数据平台与 Grafana 看板。",

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: true,
		// 链接文本
		text: "进入平台",
		// 链接 URL
		url: "https://weather.nogamenolife.cn/",
		// 内部链接
		external: true,
	},
};
