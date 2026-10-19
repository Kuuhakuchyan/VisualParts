import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

const getDynamicNavBarConfig = (): NavBarConfig => {
	const links: NavBarLink[] = [
		{
			name: "研究日志",
			url: "/",
			icon: "material-symbols:home",
		},
		{
			name: "文章",
			url: "#",
			icon: "material-symbols:article",
			children: [
				{
					name: "归档",
					url: "/archive/",
					icon: "material-symbols:archive",
				},
				{
					name: "分类",
					url: "/categories/",
					icon: "material-symbols:folder-open-rounded",
				},
				{
					name: "标签",
					url: "/tags/",
					icon: "material-symbols:tag-rounded",
				},
			],
		},
		{
			name: "关于项目",
			url: "/about/",
			icon: "material-symbols:person",
		},
		{
			name: "返回平台",
			url: "https://weather.nogamenolife.cn/",
			external: true,
			icon: "material-symbols:dashboard",
		},
	];

	return { links } as NavBarConfig;
};

export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
