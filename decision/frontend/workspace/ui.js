import { createIcons, LayoutDashboard, Map, ShieldCheck, GitCompareArrows, Database, Radio, Cpu, Logs, Activity, ArrowUpRight, ArrowRight, MapPin, RefreshCw, Menu, Thermometer, Droplets, Wind, CloudRain, Clock3, Download, ExternalLink, Layers, Crosshair, Plus, Trash2, X, Check, ChevronRight, TriangleAlert, FileCheck2, Search, Sun, Focus, Printer, Box, SlidersHorizontal, Leaf, PanelLeftClose } from "lucide";
import { Monitor, Maximize, Play, Pause, Compass, Image, Undo2, Redo2, RotateCcw, Save, MousePointer2, Move, Route, Plane, Truck, Pencil, CircleHelp } from "lucide";
import { anonymousText, anonymousValue, isCompetition } from "./edition.js";
import { PersonStanding, HardHat, HeartPulse, Baby, User, Ellipsis } from "lucide";
export { request } from "./request.js";

export const $ = (id) => document.getElementById(id);
export function icons() { createIcons({ icons: { PersonStanding, HardHat, HeartPulse, Baby, User, Ellipsis, CircleHelp, Pencil, Route, Plane, Truck, Move, Undo2, Redo2, RotateCcw, Save, MousePointer2, Monitor, Maximize, Play, Pause, Compass, Image, LayoutDashboard, Map, ShieldCheck, GitCompareArrows, Database, Radio, Cpu, Logs, Activity, ArrowUpRight, ArrowRight, MapPin, RefreshCw, Menu, Thermometer, Droplets, Wind, CloudRain, Clock3, Download, ExternalLink, Layers, Crosshair, Plus, Trash2, X, Check, ChevronRight, TriangleAlert, FileCheck2, Search, Sun, Focus, Printer, Box, SlidersHorizontal, Leaf, PanelLeftClose }, attrs: { "stroke-width": 1.6, "aria-hidden": "true" } }); }
export function escape(value) { return anonymousText(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
export const icon = (name) => `<i data-lucide="${name}"></i>`;
export const help = (text, label = "操作帮助") => `<button type="button" class="context-help" data-help="${escape(text)}" aria-label="${escape(label)}">${icon("circle-help")}</button>`;
export const numeric = (value, digits = 1) => typeof value === "number" && Number.isFinite(value) ? (Number(value.toFixed(digits)) === 0 ? (0).toFixed(digits) : value.toFixed(digits)) : "—";
export const date = (iso, short = false) => iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, ...(short ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : {}) }) : "—";
export const badge = (text, tone = "neutral") => `<span class="badge ${tone}">${escape(text)}</span>`;
export function toast(message) { $("toast").textContent = anonymousText(message); $("toast").hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $("toast").hidden = true; }, 5000); }
export function download(value, filename) { const output = isCompetition ? { presentation_redacted: true, integrity_note: "匿名展示副本；原始摘要对应未脱敏源记录，不用于验证本副本文字。地理坐标保留用于数据追溯。", record: anonymousValue(value) } : value; const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: "application/json;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export const empty = (heading, text, name = "database") => `<div class="empty-state">${icon(name)}<h3>${escape(heading)}</h3><p>${escape(text)}</p></div>`;
