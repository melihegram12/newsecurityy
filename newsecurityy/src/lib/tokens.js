// ============================================================
// Design Tokens — Malhotra Security Panel
// Tüm renk, spacing, tipografi ve gölge sabitleri burada.
// ============================================================

// --- RENKLER (Tailwind class referansları) ---
export const colors = {
  // Yüzeyler
  surface: {
    base: 'bg-slate-950',
    card: 'bg-slate-800/50',
    input: 'bg-slate-900',
    elevated: 'bg-slate-800',
    overlay: 'bg-black/80',
  },
  // Metin
  text: {
    primary: 'text-white',
    secondary: 'text-slate-300',
    muted: 'text-slate-400',
    placeholder: 'placeholder-slate-500',
    inverse: 'text-slate-950',
  },
  // Kenarlıklar
  border: {
    default: 'border-slate-600',
    muted: 'border-slate-700',
    focus: 'focus:border-blue-500',
  },
  // Vurgular
  accent: {
    blue:    { bg: 'bg-blue-600',    text: 'text-blue-400',    border: 'border-blue-500/50',   hover: 'hover:bg-blue-700' },
    green:   { bg: 'bg-green-600',   text: 'text-green-400',   border: 'border-green-500/50',  hover: 'hover:bg-green-700' },
    red:     { bg: 'bg-red-600',     text: 'text-red-400',     border: 'border-red-500/50',    hover: 'hover:bg-red-700' },
    orange:  { bg: 'bg-orange-500',  text: 'text-orange-400',  border: 'border-orange-500/50', hover: 'hover:bg-orange-600' },
    purple:  { bg: 'bg-purple-600',  text: 'text-purple-400',  border: 'border-purple-500/50', hover: 'hover:bg-purple-700' },
    cyan:    { bg: 'bg-cyan-600',    text: 'text-cyan-400',    border: 'border-cyan-500/50',   hover: 'hover:bg-cyan-700' },
    yellow:  { bg: 'bg-yellow-500',  text: 'text-yellow-400',  border: 'border-yellow-500/50', hover: 'hover:bg-yellow-600' },
    emerald: { bg: 'bg-emerald-600', text: 'text-emerald-400', border: 'border-emerald-500/50',hover: 'hover:bg-emerald-700' },
  },
};

// --- ORTAK STİL SABİTLERİ (className string'leri) ---
export const styles = {
  // Input / Select / Textarea temel stili
  input: 'w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-blue-500 transition-colors text-sm placeholder-slate-500',
  // Label stili
  label: 'block text-xs font-bold text-slate-400 mb-1 ml-1',
  // Kart yüzeyi
  card: 'bg-slate-800/50 border border-slate-700 rounded-xl',
  // Overlay (modal arka planı)
  overlay: 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm',
  // Dropdown listesi
  dropdown: 'absolute z-50 w-full bg-slate-800 border border-slate-600 rounded-b-xl shadow-2xl max-h-60 overflow-y-auto mt-1',
  // Dropdown öğesi
  dropdownItem: 'p-3 hover:bg-blue-700 hover:text-white cursor-pointer border-b border-slate-700 last:border-0 text-sm transition-all',
  // Tablo satırı
  tableRow: 'border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors',
  // Badge
  badge: 'px-2 py-0.5 rounded-full text-xs font-bold',
  // Section başlık
  sectionTitle: 'text-lg font-bold text-white flex items-center gap-2',
};

// --- DURUM RENKLERİ ---
export const statusColors = {
  inside:  { bg: 'bg-green-600', text: 'text-green-400', label: 'İÇERİDE' },
  outside: { bg: 'bg-red-600',   text: 'text-red-400',   label: 'DIŞARIDA' },
  pending: { bg: 'bg-yellow-500', text: 'text-yellow-400', label: 'BEKLİYOR' },
};

// --- YÖNLER ---
export const directionStyles = {
  entry: { bg: 'bg-green-600', border: 'border-green-500/50', text: 'text-green-400', gradient: 'from-green-600 to-emerald-600' },
  exit:  { bg: 'bg-red-600',   border: 'border-red-500/50',   text: 'text-red-400',   gradient: 'from-red-600 to-orange-600' },
};

// --- ANİMASYONLAR ---
export const animation = {
  fadeIn: 'animate-in fade-in',
  slideDown: 'animate-in fade-in slide-in-from-top-2',
  zoomIn: 'animate-in fade-in zoom-in',
};
