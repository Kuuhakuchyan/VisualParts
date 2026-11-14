import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const competitionHomeMedia=['station-timeseries.png','model-validation.png','sandbox-scene.png','homepage-scene.png','d-context.png','d-intervention.png','landcover.png','field-observation.webp','data-platform.webp','scene.js','scene.json'];
export function competitionHome(){
  let html=fs.readFileSync(path.join(root,'../api/templates/home.html'),'utf8');
  const design=fs.readFileSync(path.join(root,'../api/static/home/design.css'),'utf8')+`
    #team .team-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 24px}
    #team .team-heading h2{flex:none}
    #team .team-name{min-width:0;margin:0;color:var(--muted);font-size:1rem;line-height:1.75;overflow-wrap:anywhere}
    #team .team-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
    #team .member{min-width:0;justify-content:flex-start}
    #team .member h3{white-space:nowrap}
    @media(max-width:640px){
      #team .team-grid{gap:12px}
      #team .member h3{font-size:1.125rem}
      #team .member-mark{width:40px;height:40px;font-size:1.125rem}
    }
  `;
  const teamName='重生之我是天气之子天野阳菜队';
  const members=[
    ['董少睿','01 / LEAD','项目负责人 · 遥感科学与技术<br>总体统筹 / 智能诊断 / 空间决策'],
    ['胡翔宇','02 / ENGINEERING','工程与平台研发<br>物联网 / 系统实现'],
    ['吴悦嘉','03 / VALIDATION','数据处理与工程验证<br>数据预处理 / 接口联调 / 功能测试 / 材料整理'],
  ];
  const team=members.map(([name,index,role])=>`<article class="member"><div><span class="member-index">${index}</span><div class="member-mark">${name[0]}</div></div><div><h3>${name}</h3><p>${role}</p></div></article>`).join('\n          ');
  const teamPattern=/(<div class="team-grid">)[\s\S]*?<\/div>\s*<div class="team-note">[^<]*<\/div>/;
  if(!teamPattern.test(html))throw new Error('Competition team section missing');
  html=html.replace(teamPattern,(_match,open)=>open+'\n          '+team+'\n        </div>');
  html=html.replace('<h2>研究团队</h2>',`<div class="team-heading"><h2>研究团队</h2><p class="team-name">${teamName}</p></div>`);
  html=html.replace(/<link rel="stylesheet" href="\/home-assets\/design\.css\?v=[^"]+">/,()=>'<style>'+design+'</style>');
  html=html.replace(/郑州大学主校区|郑州大学|Zhengzhou University/gi,'某校园')
    .replaceAll('某校园校园','某校园')
    .replaceAll('/logo.png','../logo.png')
    .replaceAll('/home-assets/campus-scene.webp','./assets/homepage-scene.png')
    .replaceAll('/home-assets/campus-lcz.webp','./assets/landcover.png')
    .replaceAll('/home-assets/d-context.webp','./assets/d-context.png')
    .replaceAll('/home-assets/d-intervention.webp','./assets/d-intervention.png')
    .replaceAll('/home-assets/field-observation.webp','./assets/field-observation.webp')
    .replaceAll('/home-assets/data-platform.webp','./assets/data-platform.webp')
    .replaceAll('/home-assets/scene.js','./assets/scene.js')
    .replaceAll('/decision/ui-fonts/fonts.css','../ui-fonts/fonts.css')
    .replaceAll('href="/decision/"','href="./#screen"')
    .replaceAll('href="/monitor"','href="./#overview"')
    .replaceAll('href="/sensors"','href="./#evidence"')
    .replaceAll('href="/author/"','href="./journal.html"')
    .replaceAll('href="/author/project/"','href="./journal.html"')
    .replaceAll('href="/author/project/microjie-overview/"','href="./journal.html#project"')
    .replaceAll('href="/author/project/platform-architecture/"','href="./journal.html#engineering"')
    .replaceAll('href="/author/project/roadmap-security/"','href="./journal.html#validation"')
    .replaceAll('href="/author/posts/microjie-overview/"','href="./journal.html#project"')
    .replaceAll('href="/author/posts/platform-architecture/"','href="./journal.html#engineering"')
    .replaceAll('href="/author/posts/roadmap-security/"','href="./journal.html#validation"')
    .replace('<title>微境探界｜看见城市热环境</title>','<title>微境探界｜AIC 智慧气象</title>');
  // No outbound links to the identifying original homepage/blog in the anonymous edition.
  if(/郑州大学|Zhengzhou University|闫梓宇|href="\/(?:author|monitor|sensors)|\/home-assets\//i.test(html))throw new Error('Competition homepage disclosure check failed');
  return html;
}

export function writeCompetitionHome(output){
  const directory=path.join(output,'aic');fs.mkdirSync(path.join(directory,'assets'),{recursive:true});
  const html=competitionHome();fs.writeFileSync(path.join(directory,'home.html'),html);
  fs.writeFileSync(path.join(directory,'journal.html'),competitionJournal());
  for(const file of competitionHomeMedia)fs.copyFileSync(path.join(root,'public/aic/assets',file),path.join(directory,'assets',file));
}

export function competitionJournal(){
  const html=competitionHome();
  const head=html.slice(0,html.indexOf('<body')).replace(/\s*<link rel="preload" as="image"[^>]+>/,'');
  const articles=[
    ['project','项目概览','从区域热环境到人群防护与布局决策','微境探界融合公开气象、LCZ 分类、建筑与路网数字轮廓，将区域热风险、人群暴露、医学证据与方案比较放在同一条可追溯链路。校园现场读数、网格天气与模拟数据分别标注，不以模型输出冒充实测。'],
    ['engineering','技术路径','数值计算与大模型各司其职','拆建方案改变建筑几何，由太阳位置、遮阴和辐射模型重新计算 MRT 与 UTCI。DeepSeek 在检索证据与数值事实范围内辅助解释。单站时间序列模型独立预测15分钟温湿度，不把单站拟合当成空间改造效果验证。'],
    ['validation','验证与边界','让结果可回读、可核查','每次推演绑定建筑方案、天气时刻与网格快照；修改输入后旧报告失效。采集任务在连通路网上，按信息收益与能耗预算选择闭合路线。道路通行性、无人机空域、功率参数及专业医学建议仍需独立审核，仿真不会控制现场设备。']
  ];
  const figures=[['d-context.png','校园建筑与模拟热场，来自已批准设计的独立场景渲染'],['d-intervention.png','建筑、选定网格与空间干预的独立场景渲染，非实测结果'],['model-validation.png','模型留出验证图；适用范围以原始记录为准']];
  const index=articles.map(([id,category,title,text],i)=>`<article class="journal-entry" data-topic="${category}" data-search="${title} ${text}"><a class="journal-entry-image" href="#${id}" tabindex="-1" aria-hidden="true"><img src="./assets/${figures[i][0]}" alt="" loading="lazy"></a><div class="journal-entry-copy"><span class="journal-category">${category}</span><h2><a href="#${id}">${title}</a></h2><p>${text}</p><a class="read-more" href="#${id}">阅读全文 <span aria-hidden="true">↗</span></a></div></article>`).join('');
  const reading=articles.map(([id,category,title,text],i)=>`<article class="journal-reading" data-article="${id}" hidden><a class="read-more" href="#all">返回项目博客</a><p class="journal-category">${category}</p><h1>${title}</h1><figure class="journal-figure"><img src="./assets/${figures[i][0]}" alt="${figures[i][1]}" loading="lazy" decoding="async"><figcaption>${figures[i][1]}</figcaption></figure><p>${text}</p><a class="button secondary" href="./#evidence">查看数据与依据</a></article>`).join('');
  const behavior=fs.readFileSync(path.join(root,'frontend/home/journal.js'),'utf8');
  return head.replace('<title>微境探界｜AIC 智慧气象</title>','<title>项目博客 · 微境探界</title>')+`<body class="journal-page"><header class="topbar"><nav class="nav wrap" aria-label="项目博客导航"><a class="brand" href="./home.html"><img src="../logo.png" alt=""><span>微境探界<small>城市微气候研究与决策</small></span></a><div class="journal-links"><a href="./home.html">项目首页</a><a href="./#screen">空间决策</a><a href="./home.html#team">研究团队</a><a href="#all" aria-current="page">项目博客</a></div><a class="nav-cta" href="./#screen">访问平台</a></nav></header><main class="wrap" id="journal-main"><div id="journal-index"><header class="journal-heading"><h1>项目博客</h1><p>在真实空间里，持续探索。</p><input type="search" id="journal-search" placeholder="搜索文章" aria-label="搜索项目文章"></header><nav class="journal-topics" aria-label="文章分类"><button data-topic="all" aria-pressed="true">全部文章 <small>${articles.length}</small></button>${articles.map(([,category])=>`<button data-topic="${category}" aria-pressed="false">${category}</button>`).join('')}</nav><div class="journal-index">${index}</div><p id="journal-empty" hidden>没有找到相关文章。</p></div>${reading}</main><footer class="footer"><div class="wrap">微境探界 / <a href="./home.html">项目首页</a></div></footer><script>${behavior}</script></body></html>`;
}
