import { cn } from '@/lib/utils';

/** CARETRAIL wordmark: a trail of three steps ending in a care point. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
        <rect width="32" height="32" rx="8" fill="var(--color-brand-600)" />
        <circle cx="9" cy="22" r="2.2" fill="#fff" opacity="0.55" />
        <circle cx="15" cy="16.5" r="2.2" fill="#fff" opacity="0.75" />
        <path d="M22.5 7.5v9M18 12h9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M9 22l6-5.5 7.5-5" stroke="#fff" strokeWidth="1.2" strokeDasharray="1.5 2" opacity="0.6" fill="none" />
      </svg>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-base font-bold tracking-tight text-brand-900">CARETRAIL</span>
          <span className="block text-[11px] font-medium text-teal-700">No Patient Left Behind</span>
        </span>
      )}
    </span>
  );
}
