from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError


Image.MAX_IMAGE_PIXELS = 40_000_000

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_INPUT_PIXELS = 28_000_000
MAX_PROCESS_EDGE = 2400
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
ALLOWED_CONTENT_TYPES = {'image/jpeg', 'image/png', 'image/webp'}

DEFAULT_SETTINGS = {
    'realism_strength': 65,
    'skin_texture_recovery': 40,
    'color_naturalness': 55,
    'shadow_correction': 35,
    'grain_amount': 12,
    'sharpness_reduction': 20,
    'lens_softness': 10,
}


@dataclass(frozen=True)
class NaturalizedImage:
    original_bytes: bytes
    processed_bytes: bytes
    original_extension: str
    processed_extension: str
    processed_content_type: str
    original_width: int
    original_height: int
    output_width: int
    output_height: int
    resized_for_processing: bool
    settings: dict
    adjustments: list


def normalize_settings(raw_settings):
    raw_settings = raw_settings or {}
    normalized = {}
    for key, default in DEFAULT_SETTINGS.items():
        try:
            raw_value = raw_settings.get(key, default)
            if isinstance(raw_value, (list, tuple)):
                raw_value = raw_value[0]
            value = int(float(raw_value))
        except (TypeError, ValueError):
            value = default
        normalized[key] = max(0, min(100, value))
    return normalized


def naturalize_uploaded_image(uploaded_file, raw_settings=None, output_format=None):
    if uploaded_file is None:
        raise ValueError('Gorsel dosyasi yuklenmedi.')

    filename = uploaded_file.name or 'image'
    extension = Path(filename).suffix.lower()
    content_type = (getattr(uploaded_file, 'content_type', '') or '').lower()
    size = getattr(uploaded_file, 'size', 0) or 0

    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError('Sadece JPG, PNG veya WEBP gorseller desteklenir.')
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError('Gecersiz gorsel turu.')
    if size > MAX_UPLOAD_BYTES:
        raise ValueError('Gorsel dosyasi 15 MB sinirini asiyor.')

    original_bytes = uploaded_file.read()
    if not original_bytes:
        raise ValueError('Gorsel dosyasi bos.')

    try:
        with Image.open(BytesIO(original_bytes)) as opened:
            image = ImageOps.exif_transpose(opened)
            original_width, original_height = image.size
            if original_width * original_height > MAX_INPUT_PIXELS:
                raise ValueError('Gorsel boyutu cok buyuk.')
            image = _to_rgb(image)
    except UnidentifiedImageError as exc:
        raise ValueError('Gorsel dosyasi okunamadi.') from exc

    settings = normalize_settings(raw_settings)
    processed, resized = naturalize_image(image, settings)
    processed_bytes, processed_extension, processed_content_type = encode_image(processed, output_format)

    return NaturalizedImage(
        original_bytes=original_bytes,
        processed_bytes=processed_bytes,
        original_extension=extension,
        processed_extension=processed_extension,
        processed_content_type=processed_content_type,
        original_width=original_width,
        original_height=original_height,
        output_width=processed.width,
        output_height=processed.height,
        resized_for_processing=resized,
        settings=settings,
        adjustments=_describe_adjustments(settings),
    )


def naturalize_image(image, settings):
    image = image.copy()
    resized = False
    if max(image.size) > MAX_PROCESS_EDGE:
        image.thumbnail((MAX_PROCESS_EDGE, MAX_PROCESS_EDGE), Image.Resampling.LANCZOS)
        resized = True

    realism = settings['realism_strength'] / 100
    color = settings['color_naturalness'] / 100
    shadow = settings['shadow_correction'] / 100
    texture = settings['skin_texture_recovery'] / 100
    grain = settings['grain_amount'] / 100
    sharpness = settings['sharpness_reduction'] / 100
    lens = settings['lens_softness'] / 100

    image = _naturalize_color(image, color * realism)
    image = _soften_over_sharp_edges(image, sharpness * realism)
    image = _stabilize_light_and_shadow(image, shadow * realism)
    image = _recover_micro_texture(image, texture * realism)
    image = _add_photo_grain(image, grain * realism)
    image = _apply_lens_character(image, lens * realism, realism)

    return image, resized


def encode_image(image, output_format=None):
    fmt = (output_format or 'jpeg').lower()
    if fmt not in {'jpeg', 'jpg', 'png'}:
        fmt = 'jpeg'

    buffer = BytesIO()
    if fmt == 'png':
        image.save(buffer, format='PNG', optimize=True)
        return buffer.getvalue(), '.png', 'image/png'

    image.save(
        buffer,
        format='JPEG',
        quality=95,
        optimize=True,
        progressive=True,
        subsampling=0,
    )
    return buffer.getvalue(), '.jpg', 'image/jpeg'


def _to_rgb(image):
    if image.mode == 'RGB':
        return image.copy()
    if image.mode in {'RGBA', 'LA'} or 'transparency' in image.info:
        base = Image.new('RGB', image.size, (255, 255, 255))
        alpha = image.convert('RGBA').getchannel('A')
        base.paste(image.convert('RGB'), mask=alpha)
        return base
    return image.convert('RGB')


def _naturalize_color(image, amount):
    if amount <= 0:
        return image
    saturation = max(0.72, 1.0 - 0.26 * amount)
    contrast = max(0.90, 1.0 - 0.08 * amount)
    adjusted = ImageEnhance.Color(image).enhance(saturation)
    adjusted = ImageEnhance.Contrast(adjusted).enhance(contrast)
    return Image.blend(image, adjusted, min(0.92, 0.75 + 0.17 * amount))


def _soften_over_sharp_edges(image, amount):
    if amount <= 0:
        return image
    factor = max(0.58, 1.0 - 0.48 * amount)
    softened = ImageEnhance.Sharpness(image).enhance(factor)
    radius = 0.18 + 0.55 * amount
    micro_blur = image.filter(ImageFilter.GaussianBlur(radius=radius))
    softened = Image.blend(softened, micro_blur, 0.08 + 0.14 * amount)
    return Image.blend(image, softened, min(0.80, 0.35 + 0.45 * amount))


def _stabilize_light_and_shadow(image, amount):
    if amount <= 0:
        return image
    balanced = ImageOps.autocontrast(image, cutoff=0.35 + 1.1 * amount)
    balanced = ImageEnhance.Contrast(balanced).enhance(max(0.92, 1.0 - 0.08 * amount))
    balanced = ImageEnhance.Brightness(balanced).enhance(1.0 + 0.015 * amount)
    return Image.blend(image, balanced, min(0.32, 0.10 + 0.22 * amount))


def _recover_micro_texture(image, amount):
    if amount <= 0:
        return image
    smooth_mask = _smooth_surface_mask(image)
    sigma = 5 + 18 * amount
    noise = Image.effect_noise(image.size, sigma).convert('L')
    noise_rgb = Image.merge('RGB', (noise, noise, noise))
    textured = ImageChops.overlay(image, noise_rgb)
    textured = Image.blend(image, textured, min(0.14, 0.035 + 0.105 * amount))
    return Image.composite(textured, image, smooth_mask)


def _add_photo_grain(image, amount):
    if amount <= 0:
        return image
    sigma = 3 + 25 * amount
    noise = Image.effect_noise(image.size, sigma).convert('L')
    noise_rgb = Image.merge('RGB', (noise, noise, noise))
    grained = ImageChops.overlay(image, noise_rgb)
    return Image.blend(image, grained, min(0.12, 0.025 + 0.095 * amount))


def _apply_lens_character(image, lens_amount, realism_amount):
    amount = max(lens_amount, realism_amount * 0.06)
    if amount <= 0:
        return image
    radius = 0.20 + 1.10 * lens_amount
    blurred = image.filter(ImageFilter.GaussianBlur(radius=radius))
    edge_mask = _radial_edge_mask(image.size, strength=min(0.75, 0.35 + lens_amount))
    softened_edges = Image.composite(blurred, image, edge_mask)
    image = Image.blend(image, softened_edges, min(0.42, 0.08 + 0.34 * amount))

    vignette_mask = _radial_edge_mask(image.size, strength=min(0.55, 0.22 + realism_amount * 0.25))
    darkened = ImageEnhance.Brightness(image).enhance(0.97 - 0.04 * realism_amount)
    return Image.blend(image, Image.composite(darkened, image, vignette_mask), 0.35)


def _smooth_surface_mask(image):
    gray = image.convert('L')
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = ImageOps.autocontrast(edges)
    mask = ImageOps.invert(edges).filter(ImageFilter.GaussianBlur(radius=2.2))
    return mask.point(lambda value: max(0, min(255, int((value - 52) * 1.45))))


def _radial_edge_mask(size, strength=0.6):
    width, height = size
    cx = (width - 1) / 2
    cy = (height - 1) / 2
    max_dist = (cx * cx + cy * cy) ** 0.5 or 1
    pixels = bytearray(width * height)
    for y in range(height):
        row = y * width
        dy = y - cy
        for x in range(width):
            dx = x - cx
            dist = ((dx * dx + dy * dy) ** 0.5) / max_dist
            edge = max(0.0, (dist - 0.38) / 0.62)
            pixels[row + x] = int(255 * min(1.0, edge ** 1.45) * strength)
    return Image.frombytes('L', size, bytes(pixels)).filter(ImageFilter.GaussianBlur(radius=8))


def _describe_adjustments(settings):
    adjustments = []
    if settings['skin_texture_recovery'] > 0:
        adjustments.append('smooth_surface_micro_texture')
    if settings['color_naturalness'] > 0:
        adjustments.append('color_saturation_and_contrast_normalized')
    if settings['shadow_correction'] > 0:
        adjustments.append('light_shadow_balance')
    if settings['grain_amount'] > 0:
        adjustments.append('subtle_photo_grain')
    if settings['sharpness_reduction'] > 0:
        adjustments.append('camera_level_edge_softening')
    if settings['lens_softness'] > 0:
        adjustments.append('subtle_lens_softness_and_vignette')
    return adjustments
