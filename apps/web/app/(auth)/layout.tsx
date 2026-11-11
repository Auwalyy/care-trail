import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        <div className="rounded-(--radius-card) border bg-card p-6 shadow-(--shadow-card) sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          CARETRAIL coordinates care. It does not diagnose or prescribe.
        </p>
      </div>
    </div>
  );
}
