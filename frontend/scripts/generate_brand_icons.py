"""Draw Wearly's drawer logo into every icon the frontend serves (public/).

Same shapes as components/brand/logo-mark.tsx, on a 40x40 grid. Pillow only, so it runs in the
backend image:

    docker run --rm -v "$PWD":/repo -w /repo/frontend --entrypoint python \
        ghcr.io/anyesh/wardrowbe:backend-latest scripts/generate_brand_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ESPRESSO = (59, 42, 32, 255)  # #3b2a20
CREAM = (243, 232, 218, 255)  # #f3e8da
PUBLIC = Path(__file__).resolve().parent.parent / "public"
SUPERSAMPLE = 8
PNG_SIZES = [16, 32, 48, 96, 128, 192, 256, 512]


def draw(size: int, rounded: bool = True) -> Image.Image:
    big = size * SUPERSAMPLE
    unit = big / 40
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # The phone draws its own icon mask, so the apple-touch icon is a full square.
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=9 * unit if rounded else 0, fill=ESPRESSO)
    # Thicker strokes at small sizes, or the drawer turns into a smudge.
    stroke = (2.4 if size >= 48 else 3.4) * unit
    w = max(1, round(stroke))
    # Pillow strokes inside the box; SVG centres the stroke on the outline, so grow by half a stroke.
    h = w / 2
    d.rounded_rectangle(
        [7 * unit - h, 9 * unit - h, 33 * unit + h, 31 * unit + h], radius=3 * unit + h, outline=CREAM, width=w
    )
    for x0, y, x1 in ((7, 20, 33), (17, 14.5, 23), (17, 25.5, 23)):
        d.line([(x0 * unit, y * unit), (x1 * unit, y * unit)], fill=CREAM, width=w)
        for x in (x0, x1):
            r = w / 2
            d.ellipse([x * unit - r, y * unit - r, x * unit + r, y * unit + r], fill=CREAM)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for size in PNG_SIZES:
        draw(size).save(PUBLIC / f"icon-{size}.png")
    draw(180, rounded=False).save(PUBLIC / "apple-touch-icon.png")
    draw(256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    (PUBLIC / "logo.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
        '<rect width="40" height="40" rx="9" fill="#3b2a20"/>'
        '<g fill="none" stroke="#f3e8da" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
        '<rect x="7" y="9" width="26" height="22" rx="3"/><path d="M7 20 H33"/>'
        '<path d="M17 14.5 H23"/><path d="M17 25.5 H23"/></g></svg>\n'
    )
    print(f"wrote {len(PNG_SIZES) + 3} files to {PUBLIC}")


if __name__ == "__main__":
    main()
