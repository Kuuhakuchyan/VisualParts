import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

const getDynamicNavBarConfig = (): NavBarConfig => {
	const links: NavBarLink[] = [
		{
			name: "主页",
			url: "/",
			icon: "material-symbols:home",
		},
		{
			name: "札记",
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
			name: "关于",
			url: "/about/",
			icon: "material-symbols:person",
		},
		{
			name: "微境探界平台",
			url: "https://weather.nogamenolife.cn/",
			external: true,
			icon: "material-symbols:dashboard",
		},
		{
			name: "Firefly",
			url: "https://github.com/CuteLeaf/Firefly",
			external: true,
			icon: "fa7-brands:github",
		},
	];

	return { links } as NavBarConfig;
};

export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
