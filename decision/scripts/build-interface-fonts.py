"""Build locally served, renamed OFL subsets from real UI copy, never runtime data."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
design = root.parents[2] / 'output/ui-design-20261025-d/assets/fonts'
sources = [root / 'frontend', root / 'scripts', root / 'public/aic', root.parent / 'api/templates',
           root.parents[2] / 'author-homepage/src', root / 'backend/aic']
corpus = ''.join(chr(code) for code in range(32, 127)) + '℃°−–→㎡²³'
for folder in sources:
    for path in folder.rglob('*'):
        if path.suffix in {'.js', '.mjs', '.html', '.css', '.md', '.mdx', '.astro', '.svelte', '.ts', '.py', '.json'} and 'bundle' not in path.name:
            corpus += path.read_text(encoding='utf-8', errors='ignore')
target = root / 'public/ui-fonts'
for filename, output, characters, family in [
    ('NotoSansSC-VF.ttf', 'wjtj-sans.woff', corpus, 'WJTJ Interface SC'),
    ('IBMPlexSans-VF.ttf', 'wjtj-numeric.woff', ''.join(chr(code) for code in range(32, 127)) + '°℃−–→²³', 'WJTJ Numeric'),
]:
    font = TTFont(design / 'source' / filename)
    options = subset.Options()
    options.layout_features = ['*']
    options.flavor = 'woff'
    sub = subset.Subsetter(options=options)
    sub.populate(text=characters)
    sub.subset(font)
    ps_name = family.replace(' ', '')
    for name_id, value in {1: family, 2: 'Regular', 3: f'WJTJ:{ps_name}:Interface2026',
                           4: family, 6: ps_name, 16: family, 17: 'Regular', 25: ps_name}.items():
        font['name'].removeNames(nameID=name_id)
        font['name'].setName(value, name_id, 3, 1, 0x409)
    font.flavor = 'woff'
    font.save(target / output)
    print(output, (target / output).stat().st_size)
