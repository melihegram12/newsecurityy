// ============================================================
// Design Tokens — Malhotra Security Panel
// Tüm renk, spacing, tipografi ve gölge sabitleri burada.
// ============================================================

// --- RENKLER (Tailwind class referansları) ---
export const colors = {
  // Yüzeyler
  surface: {
    base: 'bg-zinc-950',
    card: 'bg-zinc-800/50',
    input: 'bg-black/30',
    elevated: 'bg-zinc-800',
    overlay: 'bg-black/75',
  },
  // Metin
  text: {
    primary: 'text-white',
    secondary: 'text-zinc-300',
    muted: 'text-zinc-400',
    placeholder: 'placeholder-zinc-500',
    inverse: 'text-zinc-950',
  },
  // Kenarlıklar
  border: {
    default: 'border-zinc-600/60',
    muted: 'border-zinc-700/60',
    focus: 'focus:border-blue-500',
  },
  // Vurgular
  accent: {
    blue:    { bg: 'bg-blue-600',    text: 'text-blue-400',    border: 'border-blue-500/40',   hover: 'hover:bg-blue-700' },
    green:   { bg: 'bg-emerald-600', text: 'text-emerald-400', border: 'border-emerald-500/40', hover: 'hover:bg-emerald-700' },
    red:     { bg: 'bg-red-600',     text: 'text-red-400',     border: 'border-red-500/40',    hover: 'hover:bg-red-700' },
    orange:  { bg: 'bg-orange-500',  text: 'text-orange-400',  border: 'border-orange-500/40', hover: 'hover:bg-orange-600' },
    purple:  { bg: 'bg-purple-600',  text: 'text-purple-400',  border: 'border-purple-500/40', hover: 'hover:bg-purple-700' },
    cyan:    { bg: 'bg-cyan-600',    text: 'text-cyan-400',    border: 'border-cyan-500/40',   hover: 'hover:bg-cyan-700' },
    yellow:  { bg: 'bg-yellow-500',  text: 'text-yellow-400',  border: 'border-yellow-500/40', hover: 'hover:bg-yellow-600' },
    amber:   { bg: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-500/40',  hover: 'hover:bg-amber-600' },
    emerald: { bg: 'bg-emerald-600', text: 'text-emerald-400', border: 'border-emerald-500/40',hover: 'hover:bg-emerald-700' },
  },
};

// --- ORTAK STİL SABİTLERİ (className string'leri) ---
export const styles = {
  // Input / Select / Textarea temel stili
  input: 'w-full bg-black/30 border border-zinc-600/60 rounded-md px-3 py-2 text-white outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/12 transition-all text-sm placeholder-zinc-500',
  // Label stili
  label: 'block text-[11px] font-semibold text-zinc-400 mb-1 ml-0.5 tracking-wider uppercase',
  // Kart yüzeyi
  card: 'bg-zinc-800/50 border border-zinc-700/60 rounded-md',
  // Overlay (modal arka planı)
  overlay: 'fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4',
  // Dropdown listesi
  dropdown: 'absolute z-50 w-full bg-zinc-800 border border-zinc-600/60 rounded-b shadow-xl max-h-60 overflow-y-auto mt-0.5',
  // Dropdown öğesi
  dropdownItem: 'px-3 py-2 hover:bg-blue-600/80 hover:text-white cursor-pointer border-b border-zinc-700/40 last:border-0 text-sm transition-colors',
  // Tablo satırı
  tableRow: 'border-b border-zinc-700/20 hover:bg-zinc-800/40 transition-colors',
  // Badge
  badge: 'px-2 py-0.5 rounded text-[11px] font-semibold',
  // Section başlık
  sectionTitle: 'text-sm font-bold text-white flex items-center gap-2',
};

// --- DURUM RENKLERİ ---
export const statusColors = {
  inside:  { bg: 'bg-emerald-600', text: 'text-emerald-400', label: 'İÇERİDE' },
  outside: { bg: 'bg-red-600',     text: 'text-red-400',     label: 'DIŞARIDA' },
  pending: { bg: 'bg-amber-500',   text: 'text-amber-400',   label: 'BEKLİYOR' },
};

// --- YÖNLER ---
export const directionStyles = {
  entry: { bg: 'bg-emerald-600', border: 'border-emerald-500/40', text: 'text-emerald-400', gradient: 'from-emerald-600 to-green-600' },
  exit:  { bg: 'bg-red-600',     border: 'border-red-500/40',     text: 'text-red-400',     gradient: 'from-red-600 to-rose-600' },
};

// --- ANİMASYONLAR ---
export const animation = {
  fadeIn: 'animate-in fade-in',
  slideDown: 'animate-in fade-in slide-in-from-top-2',
  zoomIn: 'animate-in fade-in zoom-in',
};
