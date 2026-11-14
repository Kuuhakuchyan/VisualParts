"""Keep the original homepage's image subjects while omitting identifying labels.

These remain research theme illustrations, not photographs of the reference station
or evidence that the depicted infrastructure is deployed for this project.
"""

from pathlib import Path

from PIL import Image


root = Path(__file__).resolve().parent.parent
source = root.parent / "api" / "static" / "home"
destination = root / "public" / "aic" / "assets"
destination.mkdir(parents=True, exist_ok=True)

# The station photograph's upper-right panel has no institute or station sign.
with Image.open(source / "field-observation.webp") as image:
    image.crop((386, 0, 750, 154)).save(
        destination / "field-observation.webp", quality=92
    )

# Retain the data-ingestion/database/spatial-index row, excluding map labels
# and the institution-specific computing-center panel below it.
with Image.open(source / "data-platform.webp") as image:
    image.crop((730, 170, 1735, 490)).save(
        destination / "data-platform.webp", quality=92
    )
