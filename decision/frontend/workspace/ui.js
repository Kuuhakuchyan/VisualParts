import { createIcons, LayoutDashboard, Map, ShieldCheck, GitCompareArrows, Database, Radio, Cpu, Logs, Activity, ArrowUpRight, ArrowRight, MapPin, RefreshCw, Menu, Thermometer, Droplets, Wind, CloudRain, Clock3, Download, ExternalLink, Layers, Crosshair, Plus, Trash2, X, Check, ChevronRight, TriangleAlert, FileCheck2, Search, Sun, Focus, Printer, Box, SlidersHorizontal, Leaf, PanelLeftClose } from "lucide";
import { Monitor, Maximize, Play, Compass, Image } from "lucide";

export const $ = (id) => document.getElementById(id);
export function icons() { createIcons({ icons: { Monitor, Maximize, Play, Compass, Image, LayoutDashboard, Map, ShieldCheck, GitCompareArrows, Database, Radio, Cpu, Logs, Activity, ArrowUpRight, ArrowRight, MapPin, RefreshCw, Menu, Thermometer, Droplets, Wind, CloudRain, Clock3, Download, ExternalLink, Layers, Crosshair, Plus, Trash2, X, Check, ChevronRight, TriangleAlert, FileCheck2, Search, Sun, Focus, Printer, Box, SlidersHorizontal, Leaf, PanelLeftClose }, attrs: { "stroke-width": 1.6, "aria-hidden": "true" } }); }
export function escape(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
export const icon = (name) => `<i data-lucide="${name}"></i>`;
export const numeric = (value, digits = 1) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
export const date = (iso, short = false) => iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, ...(short ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : {}) }) : "—";
export const badge = (text, tone = "neutral") => `<span class="badge ${tone}">${escape(text)}</span>`;
export function toast(message) { $("toast").textContent = message; $("toast").hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $("toast").hidden = true; }, 5000); }
export function download(value, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000), ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `请求未完成（${response.status}），请检查输入或稍后重试。`);
  if (!body) throw new Error("服务返回格式异常，请稍后重试。");
  return body;
}
export const empty = (heading, text, name = "database") => `<div class="empty-state">${icon(name)}<h3>${escape(heading)}</h3><p>${escape(text)}</p></div>`;
