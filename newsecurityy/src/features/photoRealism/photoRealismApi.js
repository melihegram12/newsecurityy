export const DEFAULT_PHOTO_REALISM_SETTINGS = {
  realism_strength: 65,
  skin_texture_recovery: 40,
  color_naturalness: 55,
  shadow_correction: 35,
  grain_amount: 12,
  sharpness_reduction: 20,
  lens_softness: 10,
};

export const PHOTO_REALISM_FIELDS = [
  { key: 'realism_strength', label: 'Gercekcilik seviyesi' },
  { key: 'skin_texture_recovery', label: 'Doku geri kazanimi' },
  { key: 'color_naturalness', label: 'Renk dogalligi' },
  { key: 'shadow_correction', label: 'Golge duzeltme' },
  { key: 'grain_amount', label: 'Dogal grain' },
  { key: 'sharpness_reduction', label: 'Keskinlik azaltma' },
  { key: 'lens_softness', label: 'Lens yumusakligi' },
];

export function clampPercent(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

export async function naturalizeImage({ localApiFetch, file, settings }) {
  if (!file) throw new Error('Gorsel secilmedi.');
  if (!localApiFetch) throw new Error('Yerel API baglantisi hazir degil.');

  const formData = new FormData();
  formData.append('image', file);
  Object.entries({ ...DEFAULT_PHOTO_REALISM_SETTINGS, ...settings }).forEach(([key, value]) => {
    formData.append(key, String(clampPercent(value)));
  });
  formData.append('output_format', 'jpeg');

  return localApiFetch('images/naturalize', {
    method: 'POST',
    body: formData,
  });
}
