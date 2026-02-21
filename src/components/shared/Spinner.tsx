/** Reusable loading spinner — CSS-only, inherits text color via `currentColor`. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block w-3 h-3 border-[1.5px] border-current/30 border-t-current rounded-full animate-spin shrink-0 ${className}`}
    />
  );
}
