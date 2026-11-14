"""Export reproducible copyright preparation drafts, never production data or keys."""
import argparse
from datetime import datetime, timezone
import hashlib
from html import escape
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DECISION = ROOT / "decision"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8").strip()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def export_api_worker(edition, target):
    with tempfile.TemporaryDirectory(prefix="wjtj-api-document-") as directory:
        state = Path(directory)
        for key in list(os.environ):
            if key.startswith(("AIC_", "TELEMETRY_", "DEEPSEEK_", "OPENAI_")):
                del os.environ[key]
        os.environ.update(DECISION_STATE_DB=str(state / "decision.sqlite3"), WORKSPACE_STATE_DB=str(state / "plans.sqlite3"),
                          AIC_STATE_DB=str(state / "evidence.sqlite3"), TELEMETRY_STATE_DB=str(state / "telemetry.sqlite3"),
                          TELEMETRY_MEDIA_DIR=str(state / "media"), MOBILE_TELEMETRY_ENABLED="1",
                          MOBILE_TELEMETRY_PUBLIC_VIEW="0", COLLECTION_IOT_DISABLED="1" if edition == "aic" else "0",
                          DECISION_ENABLE_LEGACY_MOCK="0")
        sys.path.insert(0, str(DECISION))
        from backend.main import app
        from backend.data_contract import contract
        value = {"edition": edition, "openapi": app.openapi(), "data_contract": contract()}
        if edition == "project":
            spec = importlib.util.spec_from_file_location("wjtj_iot_app", ROOT / "api/app.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            value["iot_openapi"] = module.app.openapi()
        write_json(target, value)


def source_files():
    paths = [DECISION / "backend/main.py"]
    for directory, suffixes in ((DECISION / "backend", {".py"}),
                                (DECISION / "frontend/workspace", {".js", ".css"}),
                                (DECISION / "frontend/home", {".js"})):
        for path in sorted(directory.rglob("*")):
            if path.suffix not in suffixes or path.name.startswith(("test_", "verify-", "capture-")) or "__pycache__" in path.parts:
                continue
            if path not in paths:
                paths.append(path)
    paths += [ROOT / "api/app.py", *sorted((ROOT / "api/templates").glob("*.html"))]
    return [path for path in paths if path.is_file() and path.stat().st_size > 0]


def untracked_source_files():
    tracked = set(subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode("utf-8").split("\0"))
    return [path.relative_to(ROOT).as_posix() for path in source_files()
            if path.relative_to(ROOT).as_posix() not in tracked]


def register_font(requested):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    font = requested or Path("C:/Windows/Fonts/simsun.ttc")
    if not font.is_file():
        raise ValueError("Pass --font with a Chinese TrueType font (TTF or supported TTC).")
    pdfmetrics.registerFont(TTFont("WJTJ", str(font), subfontIndex=0))
    return "WJTJ"


def draw_header(canvas, title, page, font, width, height, subtitle=""):
    canvas.setFillColorRGB(.13, .2, .27)
    canvas.setFont(font, 10)
    canvas.drawString(36, height - 32, title)
    canvas.setStrokeColorRGB(.78, .82, .86)
    canvas.line(36, height - 43, width - 36, height - 43)
    canvas.setFont(font, 8)
    canvas.setFillColorRGB(.4, .45, .5)
    canvas.drawString(36, 26, subtitle)
    canvas.drawRightString(width - 36, 26, str(page))


def export_source(output, identity, font):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader

    width, height = A4
    rows, files, full_text = [], [], []
    denied = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,})|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----")
    for path in source_files():
        relative = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
        if denied.search(text):
            raise ValueError("Credential-like material found in " + relative + "; export stopped")
        files.append({"path": relative, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "lines": len(text.splitlines())})
        full_text.append("\n===== " + relative + " =====\n" + text)
        rows.append({"file": relative, "line": None, "text": "FILE: " + relative})
        for number, original in enumerate(text.splitlines(), 1):
            remaining = original.expandtabs(4)
            first = True
            while remaining:
                count = min(len(remaining), 160)
                while count > 1 and pdfmetrics.stringWidth(remaining[:count], font, 8) > width - 107:
                    count -= 1
                rows.append({"file": relative, "line": number, "continuation": not first, "text": remaining[:count]})
                remaining = remaining[count:]
                first = False
            if first:
                rows.append({"file": relative, "line": number, "text": ""})
    per_page = 55
    pages = [rows[start:start + per_page] for start in range(0, len(rows), per_page)]
    selected = list(range(len(pages))) if len(pages) <= 60 else list(range(30)) + list(range(len(pages) - 30, len(pages)))
    target = output / "源程序鉴别材料-核对稿.pdf"
    pdf = canvas.Canvas(str(target), pagesize=A4)
    pdf.setTitle(identity["software_name"] + " V1.0 源程序鉴别材料核对稿")
    page_map = []
    for number, index in enumerate(selected, 1):
        draw_header(pdf, identity["software_name"] + " V1.0", number, font, width, height,
                    f"源程序核对稿 | 全文页 {index + 1}/{len(pages)}")
        pdf.setFont(font, 8)
        for offset, row in enumerate(pages[index]):
            y = height - 63 - offset * 12
            pdf.setFillColorRGB(.48, .51, .54)
            label = "" if row["line"] is None else ("+" if row.get("continuation") else str(row["line"]))
            pdf.drawRightString(65, y, label)
            pdf.setFillColorRGB(.12, .15, .19)
            pdf.drawString(74, y, row["text"])
        page_map.append({"output_page": number, "full_page": index + 1, "rows": pages[index]})
        pdf.showPage()
    pdf.save()
    assert len(PdfReader(target).pages) == len(selected)
    (output / "第一方源代码全文-核对.txt").write_text("\n".join(full_text), encoding="utf-8")
    write_json(output / "源代码选取与页码映射.json", {
        "files": files, "full_pages": len(pages), "selected_pages": len(selected), "rows_per_page": per_page,
        "policy": "First and last 30 continuous rendered pages; entire listing if at most 60. Blank lines and wrapped continuations preserved.",
        "excluded": ["node_modules", "generated bundles", "legacy dashboards", "tests", "device data", "model weights", "credentials"],
        "rights_note": "First-party source scope is an engineering selection; team ownership still requires factual confirmation.",
        "pages": page_map})
    return {"source_files": len(files), "source_pages": len(selected), "full_source_pages": len(pages)}


def export_manual(output, identity, font, screenshots):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak

    styles = {"body": ParagraphStyle("body", fontName=font, fontSize=10, leading=17, spaceAfter=6, wordWrap="CJK"),
              "title": ParagraphStyle("title", fontName=font, fontSize=20, leading=29, spaceAfter=18, wordWrap="CJK"),
              "heading": ParagraphStyle("heading", fontName=font, fontSize=13, leading=21, spaceBefore=12, spaceAfter=7, wordWrap="CJK"),
              "cell": ParagraphStyle("cell", fontName=font, fontSize=9, leading=14, wordWrap="CJK")}
    def prose(text, style="body"):
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text).replace("`", "")
        return Paragraph(escape(text), styles[style])
    story = [prose(identity["software_name"] + " V1.0", "title"), prose("软件说明与操作手册 / 核对稿", "heading"),
             prose("本稿对应源代码及功能准备工作。截图如来自公网，作为当前界面参考；不冒充已部署源码与候选提交完全相同。最终名称、权属、完成及首次发表日期据实核定后再出正式材料。"),
             prose("演示和功能验收采用模拟样例，不包含生产数据库、真实设备原始观测或服务密钥。"), PageBreak()]
    for name in ("软件用途与技术说明.md", "用户操作手册.md"):
        lines = (DECISION / "docs/copyright-v1" / name).read_text(encoding="utf-8").splitlines()
        index = 0
        while index < len(lines):
            line = lines[index].strip()
            if not line:
                index += 1
                continue
            if line.startswith("|"):
                table = []
                while index < len(lines) and lines[index].strip().startswith("|"):
                    cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                    if not all(re.fullmatch(r"[: -]+", cell or "-") for cell in cells):
                        table.append([prose(cell, "cell") for cell in cells])
                    index += 1
                item = Table(table, colWidths=[100, 405], repeatRows=1)
                item.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef3")),
                                          ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#ced6dc")),
                                          ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
                story += [item, Spacer(1, 10)]
                continue
            story.append(prose(line.lstrip("# ") if line.startswith("#") else line, "heading" if line.startswith("#") else "body"))
            index += 1
        story.append(PageBreak())
    if screenshots and not (screenshots / "manifest.json").is_file() and (screenshots / "capture-result.log").is_file():
        captured = (screenshots / "capture-result.log").read_text(encoding="utf-8-sig")
        found = re.search(r"### Result\s*\n(\{[^\n]+\})", captured)
        if not found:
            raise ValueError("Screenshot capture did not produce a successful manifest")
        write_json(screenshots / "manifest.json", json.loads(found.group(1)))
    if screenshots and (screenshots / "manifest.json").is_file():
        manifest = json.loads((screenshots / "manifest.json").read_text(encoding="utf-8"))
        story.append(prose("界面截图与来源", "heading"))
        story.append(prose("截图来源：" + manifest["origin"] + "；拍摄时间：" + manifest["captured_at"] + "。均为界面参考截图。"))
        for entry in manifest["images"]:
            image_path = (screenshots / entry["file"]).resolve()
            if not image_path.is_relative_to(screenshots.resolve()):
                raise ValueError("Screenshot path escapes the capture directory")
            image = Image(str(image_path))
            factor = min(505 / image.imageWidth, 530 / image.imageHeight)
            image.drawWidth = image.imageWidth * factor
            image.drawHeight = image.imageHeight * factor
            story += [prose(entry["title"], "heading"), image, prose(entry["url"]), PageBreak()]
    if isinstance(story[-1], PageBreak):
        story.pop()
    document = SimpleDocTemplate(str(output / "软件说明与操作手册-核对稿.pdf"), pagesize=A4,
                                 rightMargin=45, leftMargin=45, topMargin=66, bottomMargin=49)
    def header(canvas, doc):
        draw_header(canvas, identity["software_name"] + " V1.0", doc.page, font, *A4, "软件说明与操作手册 / 核对稿")
    document.build(story, onFirstPage=header, onLaterPages=header)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DECISION / "output/copyright-materials")
    parser.add_argument("--font", type=Path)
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--allow-dirty", action="store_true")
    parser.add_argument("--api-worker", choices=["project", "aic"])
    args = parser.parse_args()
    if args.api_worker:
        export_api_worker(args.api_worker, args.output)
        return 0
    untracked = untracked_source_files()
    dirty = bool(git("status", "--porcelain", "--untracked-files=no")) or bool(untracked)
    if dirty and not args.allow_dirty:
        raise ValueError("Tracked source has pending edits; commit it or explicitly export a draft with --allow-dirty.")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    identity = json.loads((DECISION / "release-version.json").read_text(encoding="utf-8"))
    font = register_font(args.font)
    totals = export_source(output, identity, font)
    export_manual(output, identity, font, args.screenshots)
    routes = []
    for edition in ("project", "aic"):
        target = output / (edition + "-api-contract.json")
        subprocess.run([sys.executable, str(Path(__file__).resolve()), "--api-worker", edition, "--output", str(target)], check=True, timeout=90)
        data = json.loads(target.read_text(encoding="utf-8"))
        for service in ("openapi", "iot_openapi"):
            for route, operations in data.get(service, {}).get("paths", {}).items():
                for method, operation in operations.items():
                    if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}:
                        routes.append({"edition": edition, "service": service, "method": method.upper(), "path": route,
                                       "summary": operation.get("summary", ""), "operation_id": operation.get("operationId")})
        if edition == "aic" and any(row["edition"] == "aic" and row["path"].startswith(("/api/weather/telemetry", "/api/weather/mobile-observations")) for row in routes):
            raise AssertionError("Competition API contract contains real mobile telemetry")
    write_json(output / "接口目录.json", routes)
    lines = ["# 当前源代码接口目录", "", "本文件从候选源码生成，不向公网开放 OpenAPI，也不包含生产凭据。权限和发布环境限制需结合服务端依赖及代理配置阅读。", "",
             "| 版本 | 服务 | 方法 | 路径 |", "|---|---|---|---|"]
    lines += [f"| {row['edition']} | {row['service']} | {row['method']} | `{row['path']}` |" for row in routes]
    (output / "接口目录.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_json(output / "material-manifest.json", {"status": "draft_for_review", "software": identity,
               "source_revision": git("rev-parse", "HEAD"), "source_dirty": dirty, "untracked_source_files": untracked,
               "generated_at": datetime.now(timezone.utc).isoformat(), **totals, "endpoint_count": len(routes),
               "files": [{"path": path.name, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                         for path in sorted(output.iterdir()) if path.is_file() and path.name != "material-manifest.json"],
               "pending": ["ownership facts", "final software name confirmation", "completion/publication dates", "final screenshots after release freeze", "current filing format check"]})
    print(f"Copyright preparation exported: {totals['source_files']} source files, {totals['source_pages']} code pages, {len(routes)} endpoint entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
