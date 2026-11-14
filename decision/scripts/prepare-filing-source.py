"""Produce a portrait code listing with at least 50 nonblank source lines per page."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-dirty", action="store_true")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("materials", Path(__file__).with_name("prepare-copyright-materials.py"))
    materials = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(materials)
    dirty = bool(materials.git("status", "--porcelain", "--untracked-files=no")) or bool(materials.untracked_source_files())
    if dirty and not args.allow_dirty:
        raise ValueError("Commit the selected source before preparing filing pages")
    import black
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader
    args.output.mkdir(parents=True, exist_ok=True)
    font = materials.register_font(None)
    identity = json.loads((ROOT / "decision/release-version.json").read_text(encoding="utf-8"))
    rows, files, full = [], [], []
    with tempfile.TemporaryDirectory(prefix="wjtj-source-layout-") as tmp:
        prepared = Path(tmp)
        paths = materials.source_files()
        for path in paths:
            raw = path.read_text(encoding="utf-8-sig")
            if re.search(r"\b(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,})|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----", raw):
                raise ValueError("Credential-like source material: " + str(path.relative_to(ROOT)))
            dest = prepared / path.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                text = black.format_file_contents(raw, fast=False, mode=black.Mode(line_length=84)) if path.suffix == ".py" else raw
            except black.NothingChanged:
                text = raw
            dest.write_text(text, encoding="utf-8")
        command = [shutil.which("npx.cmd") or shutil.which("npx"), "--yes", "--package", "prettier@3.6.2", "prettier", "--write", "--print-width", "84",
                   str(prepared / "**/*.js"), str(prepared / "**/*.css"), str(prepared / "**/*.html")]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, timeout=180)
        for path in paths:
            relative = path.relative_to(ROOT).as_posix()
            text = (prepared / relative).read_text(encoding="utf-8")
            full.append("\n===== " + relative + " =====\n" + text)
            files.append({"path": relative, "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                          "formatted_sha256": hashlib.sha256(text.encode()).hexdigest()})
            rows.extend({"file": relative, "formatted_line": n, "text": line.expandtabs(4)}
                        for n, line in enumerate(text.splitlines(), 1) if line.strip())
    # Balance the final pages too; blank lines and wrapping never count toward 50.
    count = max(1, len(rows) // 50)
    small, extra = divmod(len(rows), count)
    pages, offset = [], 0
    for index in range(count):
        size = small + (index < extra)
        pages.append(rows[offset:offset + size])
        offset += size
    selected = list(range(count)) if count <= 60 else list(range(30)) + list(range(count - 30, count))
    width, height = A4
    pdf = canvas.Canvas(str(args.output / "源程序鉴别材料-排版版.pdf"), pagesize=A4)
    pdf.setTitle(identity["software_name"] + " V1.0 源程序")
    mapping = []
    for page_number, index in enumerate(selected, 1):
        entries = pages[index]
        display, point = [], 8.2
        while point >= 6.5:
            display = []
            for entry in entries:
                rest = entry["text"]
                first = True
                while rest:
                    end = len(rest)
                    while end > 1 and pdfmetrics.stringWidth(rest[:end], font, point) > width - 110:
                        end -= 1
                    display.append((entry, rest[:end], first))
                    rest, first = rest[end:], False
            if len(display) * point * 1.35 <= height - 135:
                break
            point -= .2
        if len(display) * point * 1.35 > height - 135 or len(entries) < 50:
            raise ValueError("Page cannot satisfy source line count and readable portrait layout")
        materials.draw_header(pdf, identity["software_name"] + " V1.0", page_number, font, width, height,
                              "源程序 / 全文页 " + str(index + 1))
        pdf.setFont(font, point)
        for number, (entry, segment, first) in enumerate(display):
            y = height - 63 - number * point * 1.35
            pdf.setFillColorRGB(.43, .46, .48)
            pdf.drawRightString(66, y, str(entry["formatted_line"]) if first else "+")
            pdf.setFillColorRGB(.08, .1, .12)
            pdf.drawString(75, y, segment)
        pdf.showPage()
        mapping.append({"output_page": page_number, "full_page": index + 1, "nonblank_source_lines": len(entries),
                        "rendered_rows": len(display), "font_size": round(point, 2), "source_lines": entries})
    pdf.save()
    assert len(PdfReader(args.output / "源程序鉴别材料-排版版.pdf").pages) == len(selected)
    (args.output / "源程序排版全文.txt").write_text("\n".join(full), encoding="utf-8")
    manifest = {"source_revision": materials.git("rev-parse", "HEAD"), "source_dirty": dirty, "files": files,
                "formatters": {"python": "Black " + black.__version__ + " with AST equivalence check", "web": "Prettier 3.6.2"},
                "line_coordinates": "formatted source; original source hashes retained; blank lines omitted only in PDF",
                "full_pages": count, "selected_pages": len(selected), "minimum_nonblank_source_lines": min(len(p) for p in pages),
                "pages": mapping}
    (args.output / "排版页码与行数核验.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Filing source: {len(selected)} pages, at least {manifest['minimum_nonblank_source_lines']} nonblank source lines/page")


if __name__ == "__main__":
    main()
