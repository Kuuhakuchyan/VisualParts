import { existsSync, rmSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);

const disabledRoutes = [
	"anime",
	"bangumi",
	"dynamic",
	"friends",
	"gallery",
	"guestbook",
	"sponsor",
];

for (const route of disabledRoutes) {
	const target = new URL(`${route}/`, dist);
	if (existsSync(target)) {
		rmSync(target, { recursive: true, force: true });
	}
}

const dynamicApi = new URL("api/dynamic.json", dist);
if (existsSync(dynamicApi)) {
	rmSync(dynamicApi, { force: true });
}

const urls = [
	"https://weather.nogamenolife.cn/author/",
	"https://weather.nogamenolife.cn/author/about/",
	"https://weather.nogamenolife.cn/author/archive/",
	"https://weather.nogamenolife.cn/author/categories/",
	"https://weather.nogamenolife.cn/author/posts/microjie-overview/",
	"https://weather.nogamenolife.cn/author/posts/platform-architecture/",
	"https://weather.nogamenolife.cn/author/posts/roadmap-security/",
	"https://weather.nogamenolife.cn/author/rss/",
	"https://weather.nogamenolife.cn/author/search/",
	"https://weather.nogamenolife.cn/author/tags/",
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
	.map((loc) => `  <url><loc>${loc}</loc></url>`)
	.join("\n")}\n</urlset>\n`;

writeFileSync(new URL("sitemap-0.xml", dist), sitemap, "utf8");

console.log("Cleaned disabled author-site routes from dist.");
