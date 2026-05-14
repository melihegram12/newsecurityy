import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, Download, ImagePlus, RefreshCw, SlidersHorizontal, Wand2 } from 'lucide-react';

import { Button, Card, FormField, Input, Badge } from '../../components/ui';
import { cx, humanFileSize } from '../../lib/utils';
import {
  DEFAULT_PHOTO_REALISM_SETTINGS,
  PHOTO_REALISM_FIELDS,
  clampPercent,
  naturalizeImage,
} from './photoRealismApi';

const MAX_CLIENT_FILE_SIZE = 15 * 1024 * 1024;

export default function PhotoRealismTool({ canUseLocalApi, localApiFetch }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [settings, setSettings] = useState(DEFAULT_PHOTO_REALISM_SETTINGS);
  const [result, setResult] = useState(null);
  const [compare, setCompare] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const fileMeta = useMemo(() => {
    if (!file) return '';
    return `${file.name} · ${humanFileSize(file.size)}`;
  }, [file]);

  const statusText = loading
    ? 'Gorsel isleniyor. Sonuc hazir oldugunda karsilastirma alani guncellenecek.'
    : result?.processed_url
      ? 'Islenmis gorsel hazir. Karsilastirma cubuguyla sonucu kontrol edebilirsiniz.'
      : 'JPG, PNG veya WEBP dosyasi yukleyin. Orijinal gorsel korunur.';

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setResult(null);
    setError('');

    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!nextFile.type?.startsWith('image/')) {
      setFile(null);
      event.target.value = '';
      setError('Dosya turu desteklenmiyor. JPG, PNG veya WEBP gorsel secin.');
      return;
    }
    if (nextFile.size > MAX_CLIENT_FILE_SIZE) {
      setFile(null);
      event.target.value = '';
      setError('Dosya 15 MB sinirini asiyor. Daha kucuk bir gorsel yukleyin.');
      return;
    }
    setFile(nextFile);
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: clampPercent(value) }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_PHOTO_REALISM_SETTINGS);
  };

  const handleNaturalize = async () => {
    if (!canUseLocalApi) {
      setError('Yerel API baglantisi aktif degil.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await naturalizeImage({ localApiFetch, file, settings });
      setResult(payload);
      setCompare(50);
    } catch (err) {
      setError(`${err?.message || 'Gorsel islenemedi.'} Baglantiyi ve ayarlari kontrol edip tekrar deneyin.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)] gap-4">
        <Card className="p-4 space-y-4" aria-busy={loading}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Camera size={18} className="text-cyan-300" /> Gorsel iyilestirme
              </h2>
              {fileMeta && <div className="text-xs text-zinc-500 mt-1">{fileMeta}</div>}
              <div className="text-xs text-muted-foreground mt-1" role="status" aria-live="polite">
                {statusText}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {result?.processed_url && <Badge variant="green">Hazir</Badge>}
              <Button
                onClick={handleNaturalize}
                disabled={!file || loading || !canUseLocalApi}
                className="gap-2"
                title={!canUseLocalApi ? 'Yerel API baglantisi gerekli' : !file ? 'Once bir gorsel yukleyin' : undefined}
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {loading ? 'Isleniyor' : 'Dogallastir'}
              </Button>
              {result?.processed_url && (
                <a
                  href={result.processed_url}
                  download
                  className={cx("ui-btn ui-btn-secondary px-4 py-2 gap-2")}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={16} /> Indir
                </a>
              )}
            </div>
          </div>

          <FormField
            label="Gorsel yukle"
            htmlFor="photo-realism-file"
            helper="JPG, PNG veya WEBP; en fazla 15 MB."
            error={error}
          >
            <Input id="photo-realism-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
          </FormField>

          <div className="relative overflow-hidden rounded-lg border border-border/70 bg-background/60 aspect-[4/3] min-h-[260px]">
            {!previewUrl ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
                <ImagePlus size={34} />
                <span className="text-sm text-foreground/80">Gorsel secilmedi</span>
                <span className="max-w-xs px-6 text-center text-xs text-muted-foreground">
                  Dosya yukledikten sonra onizleme ve karsilastirma burada gorunur.
                </span>
              </div>
            ) : (
              <>
                <img src={previewUrl} alt="Orijinal gorsel" className="absolute inset-0 h-full w-full object-contain" />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm" role="status" aria-live="polite">
                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/90 px-3 py-2 text-sm text-foreground">
                      <RefreshCw size={16} className="animate-spin text-cyan-300" />
                      Gorsel isleniyor
                    </div>
                  </div>
                )}
                {result?.processed_url && (
                  <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}>
                    <img src={result.processed_url} alt="Dogallastirilmis gorsel" className="absolute inset-0 h-full w-full object-contain" />
                  </div>
                )}
                {result?.processed_url && (
                  <div className="absolute inset-y-0 w-px bg-cyan-200 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style={{ left: `${compare}%` }} />
                )}
              </>
            )}
          </div>

          {result?.processed_url && (
            <FormField label="Once / sonra" htmlFor="photo-realism-compare">
              <input
                id="photo-realism-compare"
                type="range"
                min="0"
                max="100"
                value={compare}
                onChange={(event) => setCompare(clampPercent(event.target.value))}
                className="w-full accent-cyan-400"
              />
            </FormField>
          )}

          {!canUseLocalApi && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Yerel API baglantisi gerekli. Sunucu ayarlarinda API adresini kontrol edin.</span>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-cyan-300" /> Ayarlar
            </h2>
            <Button onClick={resetSettings} variant="ghost" size="sm">Sifirla</Button>
          </div>

          <div className="space-y-3">
            {PHOTO_REALISM_FIELDS.map(field => (
              <FormField key={field.key} label={field.label} htmlFor={`photo-realism-${field.key}`}>
                <div className="grid grid-cols-[1fr_72px] gap-2 items-center">
                  <input
                    id={`photo-realism-${field.key}`}
                    type="range"
                    min="0"
                    max="100"
                    value={settings[field.key]}
                    onChange={(event) => updateSetting(field.key, event.target.value)}
                    className="w-full accent-cyan-400"
                  />
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={settings[field.key]}
                    onChange={(event) => updateSetting(field.key, event.target.value)}
                    className="text-right tabular-nums"
                  />
                </div>
              </FormField>
            ))}
          </div>

          {result && (
            <div className={cx("rounded-md border border-border/60 bg-black/20 p-3 text-xs text-zinc-400 space-y-1")}>
              <div>Orijinal: {result.original_dimensions?.width}x{result.original_dimensions?.height}</div>
              <div>Sonuc: {result.output_dimensions?.width}x{result.output_dimensions?.height}</div>
              {result.resized_for_processing && <div>Buyuk gorsel performans icin olceklendi.</div>}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
