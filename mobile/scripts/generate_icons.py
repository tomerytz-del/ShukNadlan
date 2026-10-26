#!/usr/bin/env python3
"""אייקונים ומסכי פתיחה לאפליקציה, מתוך אייקון המותג הקיים."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "assets" / "icon-512.png"
ANDROID = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"
IOS_ICON = ROOT / "mobile" / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
IOS_SPLASH = ROOT / "mobile" / "ios" / "App" / "App" / "Assets.xcassets" / "Splash.imageset"
BG = (14, 42, 107, 255)


def flatten(im: Image.Image, size: int) -> Image.Image:
    src = im.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(src)
    return canvas.convert("RGB")


def adaptive(im: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    inner = int(size * 0.72)
    icon = im.convert("RGBA").resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, ((size - inner) // 2, (size - inner) // 2))
    return canvas.convert("RGB")


def splash(im: Image.Image, w: int, h: int) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), BG)
    side = int(min(w, h) * 0.38)
    icon = im.convert("RGBA").resize((side, side), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, ((w - side) // 2, (h - side) // 2))
    return canvas.convert("RGB")


def main() -> None:
    brand = Image.open(BRAND)
    launchers = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    foregrounds = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    for folder, size in launchers.items():
        img = flatten(brand, size)
        dest = ANDROID / folder
        img.save(dest / "ic_launcher.png", "PNG")
        img.save(dest / "ic_launcher_round.png", "PNG")
    for folder, size in foregrounds.items():
        adaptive(brand, size).save(ANDROID / folder / "ic_launcher_foreground.png", "PNG")

    splashes = {
        "drawable/splash.png": (480, 320),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    }
    for rel, (w, h) in splashes.items():
        splash(brand, w, h).save(ANDROID / rel, "PNG")

    flatten(brand, 192).save(ROOT / "mobile" / "www" / "icon.png", "PNG")
    icon = flatten(brand, 1024)
    icon.save(IOS_ICON / "AppIcon-512@2x.png", "PNG")
    sheet = splash(brand, 2732, 2732)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        sheet.save(IOS_SPLASH / name, "PNG")
    print("icons: android mipmaps, splash, ios appicon")


if __name__ == "__main__":
    main()
