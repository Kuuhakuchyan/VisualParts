"""Subset the licensed design fonts against the shipped interface vocabulary."""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--blog', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
folders = [root / 'frontend', root / 'public/aic', root.parent / 'api/templates']
if args.blog:
    folders.append(args.blog / 'src')
text = ''.join(chr(i) for i in range(32, 256)) + '℃°−–→↗²³'
for folder in folders:
    for path in folder.rglob('*'):
        if path.suffix in {'.html', '.js', '.astro', '.md', '.mdx', '.json'}:
            text += path.read_text(encoding='utf-8')
target = root / 'public/ui-fonts'
target.mkdir(exist_ok=True)
for source, name, characters in [
    ('NotoSansSC-VF.ttf', 'wjtj-sans', text),
    ('IBMPlexSans-VF.ttf', 'wjtj-numeric', ''.join(chr(i) for i in range(32, 256)) + '℃°−–→²³'),
]:
    font = TTFont(args.source_dir / source)
    options = subset.Options()
    options.layout_features = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(text=characters)
    sub.subset(font)
    font.flavor = 'woff'
    font.save(target / (name + '.woff'))
    print(name, (target / (name + '.woff')).stat().st_size)
