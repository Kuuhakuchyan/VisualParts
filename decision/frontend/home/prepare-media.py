"""Encode approved standalone renders and reuse anonymous project evidence."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
media = root / 'public/aic/assets'
home = root.parent / 'api/static/home'
for source, target in [
    ('homepage-scene.png', 'campus-scene.webp'),
    ('d-context.png', 'd-context.webp'),
    ('d-intervention.png', 'd-intervention.webp'),
    ('landcover.png', 'campus-lcz.webp'),
    ('station-timeseries.png', 'data-platform.webp'),
    ('field-observation.webp', 'field-observation.webp'),
]:
    with Image.open(media / source) as image:
        image.convert('RGB').save(home / target, quality=94, method=6)
with Image.open(media / 'station-timeseries.png') as image:
    image.convert('RGB').save(media / 'data-platform.webp', quality=94, method=6)
print('Prepared six homepage images from approved renders and anonymous evidence.')
