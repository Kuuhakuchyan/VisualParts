"""Patch only homepage response headers and exact anonymous HTML locations."""

import ast
import pathlib
import sys


app_path = pathlib.Path(sys.argv[1])
nginx_path = pathlib.Path(sys.argv[2])
source = app_path.read_text(encoding="utf-8")
tree = ast.parse(source)
replacements = []
for node in tree.body:
    if not isinstance(node, ast.AsyncFunctionDef) or node.name not in {"home_asset", "dashboard", "dashboard_head"}:
        continue
    for call in ast.walk(node):
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name):
            continue
        if call.func.id not in {"FileResponse", "Response"}:
            continue
        old = ast.get_source_segment(source, call)
        if any(keyword.arg == "headers" for keyword in call.keywords):
            if '"no-cache, must-revalidate"' not in old:
                raise ValueError("Unexpected existing homepage headers")
            continue
        replacements.append((old, old[:-1] + ', headers={"Cache-Control": "no-cache, must-revalidate"})'))
if len(replacements) not in {0, 3}:
    raise ValueError("Unexpected homepage response structure")
for old, new in replacements:
    if source.count(old) != 1:
        raise ValueError("Ambiguous response replacement")
    source = source.replace(old, new, 1)
ast.parse(source)
app_path.write_text(source, encoding="utf-8")

config = nginx_path.read_text(encoding="utf-8")
if "location = /decision/aic/home.html" not in config:
    marker = "    location /decision/ {"
    if config.count(marker) != 1:
        raise ValueError("Unexpected decision site location")
    blocks = """    location = /decision/aic/home.html {
        alias /var/www/microclimate-decision/aic/home.html;
        expires -1;
    }

    location = /decision/aic/journal.html {
        alias /var/www/microclimate-decision/aic/journal.html;
        expires -1;
    }

"""
    config = config.replace(marker, blocks + marker, 1)
    nginx_path.write_text(config, encoding="utf-8")
print("Homepage cache response patch applied")
