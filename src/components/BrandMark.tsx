export function BrandMark({ className = "" }: { className?: string }) {
  return <img className={`brand-mark ${className}`.trim()} src="/gama-mark.png" alt="" aria-hidden="true" />;
}
