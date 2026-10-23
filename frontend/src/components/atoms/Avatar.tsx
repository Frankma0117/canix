const AVATAR_GRADIENTS = [
  'from-[#2f8bff] to-[#5b4cf5]',
  'from-[#7c5cff] to-[#b04cf0]',
  'from-[#1fc8e3] to-[#2f8bff]',
  'from-[#ff7ab6] to-[#8b5cf6]',
  'from-[#19c58f] to-[#12a4b8]',
  'from-[#ffb020] to-[#ff5f6d]',
];

/** Initials avatar with a stable per-person gradient. */
export function Avatar({ name, seed, size = 40 }: { name: string | null; seed: number; size?: number }) {
  const initials =
    (name ?? '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-display font-black text-white shadow-sm ${AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
