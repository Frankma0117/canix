import { useId } from 'react';

/**
 * Brand mark: the sticker mascot's head (white helmet, ear pods, dark visor, cyan smiling LED eyes)
 * inside the gradient hexagon it wears on its chest - so the logo, the favicon (public/favicon.svg,
 * same drawing) and the sticker pack read as one family.
 */
export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Canix">
      <defs>
        <linearGradient id={`hex-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f8bff" />
          <stop offset="0.55" stopColor="#5b4cf5" />
          <stop offset="1" stopColor="#8b3fe4" />
        </linearGradient>
        <linearGradient id={`helmet-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e4e9fb" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5ff0ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5ff0ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon
        points="50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5"
        fill={`url(#hex-${id})`}
        stroke={`url(#hex-${id})`}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* ear pods */}
      <rect x="19" y="41" width="11" height="22" rx="5.5" fill="#cfd8f6" />
      <rect x="70" y="41" width="11" height="22" rx="5.5" fill="#cfd8f6" />
      {/* helmet */}
      <rect x="25" y="27" width="50" height="46" rx="19" fill={`url(#helmet-${id})`} />
      <path d="M33 33 Q40 29 48 29" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9" />
      {/* visor */}
      <rect x="31" y="37" width="38" height="27" rx="12" fill="#121735" />
      <ellipse cx="50" cy="52" rx="16" ry="9" fill={`url(#glow-${id})`} />
      {/* happy LED eyes */}
      <path d="M38.5 53 Q43 46.5 47.5 53" stroke="#3fe6ff" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M52.5 53 Q57 46.5 61.5 53" stroke="#3fe6ff" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Mark + "Canix" wordmark in the sticker lettering style. */
export function Logo({ size = 40, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={size} className="drop-shadow-[0_6px_14px_rgba(91,76,245,0.35)]" />
      <div className="min-w-0 leading-none">
        <p className="font-display text-xl font-black tracking-tight text-navy dark:text-white">
          Can<span className="text-gradient">ix</span>
        </p>
        {subtitle && <p className="mt-1 truncate text-xs font-medium text-gray-dark">{subtitle}</p>}
      </div>
    </div>
  );
}
