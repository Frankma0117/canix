export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-medium/70 dark:bg-white/10 ${className}`} />;
}
