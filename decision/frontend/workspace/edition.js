export const isCompetition = import.meta.env.VITE_EDITION === 'competition' || location.hostname === 'aic.nogamenolife.cn' || /\/aic(?:\/|$)/.test(location.pathname);
export const assessmentHref = import.meta.env.VITE_EDITION === 'competition' ? '/aic/assessment.html' : `${import.meta.env.BASE_URL}self-check/assessment.html`;
export const projectHomeHref = isCompetition ? (location.hostname === 'aic.nogamenolife.cn' ? '/aic/home.html' : './home.html') : import.meta.env.DEV ? '/home.html' : '/';
export function anonymousText(value) {
  const text = String(value ?? "");
  return isCompetition ? text.replace(/郑州大学|Zhengzhou\s+University|ZZU/gi, "某校园").replace(/闫梓宇/g, "指导教师（匿名）").replace(/郑州\s*[·・]?\s*中原区|中原区|郑州城区/g, "某街区") : text;
}
export function anonymousValue(value) {
  if (typeof value === "string") return anonymousText(value);
  if (Array.isArray(value)) return value.map(anonymousValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, anonymousValue(v)]));
  return value;
}
export function configureEdition() {
  const competition = isCompetition;
  const base = import.meta.env.BASE_URL;
  document.documentElement.dataset.edition = competition ? "competition" : "platform";
  document.querySelector(".brand img").src = `${base}logo.png`;
  document.querySelector(".brand").href = projectHomeHref;
  document.querySelector('link[rel="icon"]').href = `${base}logo.png`;
  const home=document.createElement('a');home.href=projectHomeHref;home.textContent='项目主页';home.className=competition?'competition-home-link':'project-home-link';document.querySelector('.primary-nav').prepend(home);
  if (!competition) return false;
  document.querySelector(".brand small").textContent = "AIC 智慧气象";
  document.querySelector(".workspace-label").firstChild.textContent = "竞赛版工作台 ";
  document.querySelector(".sidebar-secondary").remove();
  document.querySelector(".workspace-footer a")?.remove();
  document.querySelector(".workspace-footer>span").textContent = "微境探界 / AIC 竞赛版";
  document.querySelector('#site-select option[value=zhongyuan]').textContent = "某街区";
  document.querySelector('#site-select option[value=campus]').textContent = "某校园";
  return true;
}
