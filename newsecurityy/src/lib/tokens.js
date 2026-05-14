// ============================================================
// Design Tokens — Malhotra Security Panel
// Tüm renk, spacing, tipografi ve gölge sabitleri burada.
// ============================================================

// --- RENKLER (Tailwind class referansları) ---
export const colors = {
  // Yüzeyler
  surface: {
    base: 'bg-background',
    card: 'bg-card/80',
    input: 'bg-background/60',
    elevated: 'bg-secondary/70',
    overlay: 'bg-black/70',
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
    default: 'border-border/70',
    muted: 'border-border/50',
    focus: 'focus:border-sky-500/60',
  },
  // Vurgular
  accent: {
    blue:    { bg: 'bg-sky-700',     text: 'text-sky-300',     border: 'border-sky-500/30',     hover: 'hover:bg-sky-800' },
    green:   { bg: 'bg-emerald-700', text: 'text-emerald-300', border: 'border-emerald-500/30', hover: 'hover:bg-emerald-800' },
    red:     { bg: 'bg-red-700',     text: 'text-red-300',     border: 'border-red-500/30',     hover: 'hover:bg-red-800' },
    orange:  { bg: 'bg-orange-600',  text: 'text-orange-300',  border: 'border-orange-500/30',  hover: 'hover:bg-orange-700' },
    purple:  { bg: 'bg-indigo-700',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  hover: 'hover:bg-indigo-800' },
    cyan:    { bg: 'bg-cyan-700',    text: 'text-cyan-300',    border: 'border-cyan-500/30',    hover: 'hover:bg-cyan-800' },
    yellow:  { bg: 'bg-yellow-600',  text: 'text-yellow-300',  border: 'border-yellow-500/30',  hover: 'hover:bg-yellow-700' },
    amber:   { bg: 'bg-amber-600',   text: 'text-amber-300',   border: 'border-amber-500/30',   hover: 'hover:bg-amber-700' },
    emerald: { bg: 'bg-emerald-700', text: 'text-emerald-300', border: 'border-emerald-500/30', hover: 'hover:bg-emerald-800' },
  },
};

// --- ORTAK STİL SABİTLERİ (className string'leri) ---
export const styles = {
  // Input / Select / Textarea temel stili
  input: 'w-full bg-background/60 border border-input/80 rounded-lg px-3 py-2 text-foreground outline-none focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20 transition-all text-sm placeholder:text-muted-foreground/70',
  // Label stili
  label: 'block text-xs font-medium text-muted-foreground mb-1 ml-0.5',
  // Kart yüzeyi
  card: 'bg-card/80 border border-border/70 rounded-lg',
  // Overlay (modal arka planı)
  overlay: 'fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4',
  // Dropdown listesi
  dropdown: 'absolute z-50 w-full bg-popover border border-border/70 rounded-lg shadow-card max-h-60 overflow-y-auto mt-1',
  // Dropdown öğesi
  dropdownItem: 'block w-full text-left px-3 py-2 hover:bg-accent hover:text-foreground cursor-pointer border-b border-border/30 last:border-0 text-sm transition-colors focus-visible:outline-none focus-visible:bg-accent',
  // Tablo satırı
  tableRow: 'border-b border-border/30 hover:bg-accent/25 transition-colors',
  // Badge
  badge: 'px-2 py-0.5 rounded-md text-[11px] font-medium',
  // Section başlık
  sectionTitle: 'text-sm font-semibold text-foreground flex items-center gap-2',
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
