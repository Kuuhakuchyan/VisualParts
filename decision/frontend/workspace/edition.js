export function configureEdition() {
  const competition = /\/aic(?:\/|$)/.test(location.pathname);
  const base = import.meta.env.BASE_URL;
  document.documentElement.dataset.edition = competition ? "competition" : "platform";
  document.querySelector(".brand img").src = `${base}logo.png`;
  document.querySelector('link[rel="icon"]').href = `${base}logo.png`;
  if (!competition) return false;
  document.querySelector(".brand").href = "#screen";
  document.querySelector(".brand small").textContent = "AIC · COMPETITION EDITION";
  document.querySelector(".workspace-label").firstChild.textContent = "竞赛版工作台 ";
  document.querySelector(".sidebar-secondary").remove();
  document.querySelector(".workspace-footer a").remove();
  document.querySelector(".workspace-footer>span").textContent = "微境探界 / AIC 竞赛版";
  return true;
}
