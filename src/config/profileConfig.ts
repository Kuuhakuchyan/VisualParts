import type { ProfileConfig } from "../types/profileConfig";

export const profileConfig: ProfileConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "assets/images/avatar.avif",

	// 名字
	name: "Kuuhakuchyan",

	// 个人签名
	bio: "项目作品、研究记录与技术实践",

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "微境探界平台",
			icon: "material-symbols:dashboard",
			url: "https://weather.nogamenolife.cn/",
			showName: true,
		},
		{
			name: "Grafana",
			icon: "material-symbols:monitoring",
			url: "https://weather.nogamenolife.cn/grafana/",
			showName: true,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			showName: true,
		},
	],
};
