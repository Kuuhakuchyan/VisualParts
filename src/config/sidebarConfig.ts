import type { SidebarLayoutConfig } from "../types/sidebarConfig";

export const sidebarLayoutConfig: SidebarLayoutConfig = {
	enable: true,
	position: "right",
	tabletSidebar: "right",
	hideSidebarOnPostPage: false,
	showBothSidebarsOnPostPage: false,
	leftComponents: [],
	rightComponents: [
		{
			type: "profile",
			enable: true,
			position: "top",
			showOnPostPage: true,
		},
		{
			type: "announcement",
			enable: true,
			position: "top",
			showOnPostPage: true,
		},
		{
			type: "categories",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			specificConfig: {
				collapseThreshold: 5,
			},
		},
		{
			type: "tags",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			specificConfig: {
				collapseThreshold: 12,
			},
		},
		{
			type: "siteInfo",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			specificConfig: {
				siteInfo: {
					unknownBuildPlatform: "本地构建",
				},
			},
		},
		{
			type: "sidebarToc",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			hideOnNonPostPage: true,
		},
	],
	mobileBottomComponents: [
		{
			type: "profile",
			enable: true,
			showOnPostPage: true,
		},
		{
			type: "announcement",
			enable: true,
			showOnPostPage: true,
		},
		{
			type: "categories",
			enable: true,
			showOnPostPage: true,
			specificConfig: {
				collapseThreshold: 5,
			},
		},
		{
			type: "tags",
			enable: true,
			showOnPostPage: true,
			specificConfig: {
				collapseThreshold: 12,
			},
		},
	],
};
