import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
  variant?: 'default' | 'light' | 'dark';
  /** Datos de empresa. Si se omiten, usa valores neutros — pasarlos desde el padre server cuando sea posible. */
  company?: Pick<CompanyConfig, 'name' | 'tagline' | 'logoUrl'>;
}

export function Logo({
  className,
  width = 120,
  height = 40,
  variant = 'default',
  company,
}: LogoProps) {
  const src = company?.logoUrl || '/images/logo.avif';
  const name = company?.name || 'Logo';
  const tagline = company?.tagline || '';
  const alt = tagline ? `${name} - ${tagline}` : name;
  const imgClassName = cn(
    "object-contain",
    variant === 'light' && "brightness-0 invert",
    variant === 'dark' && "brightness-0"
  );

  // Los logos guardados en companyConfig llegan como data URL base64.
  // Next.js Image loguea un warning enorme volcando el data URL completo
  // cuando lo recibe, así que usamos <img> normal: Next.js Image no aporta
  // optimización sobre data URLs (ya están inline) — sólo ruido en consola.
  const isDataUrl = src.startsWith('data:');

  return (
    <Link
      href="/"
      className={cn(
        "block relative transition-opacity hover:opacity-80",
        className
      )}
    >
      {isDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={imgClassName}
          style={{ width: 'auto', height: 'auto', maxWidth: width, maxHeight: height }}
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={imgClassName}
          // Evita el warning "width or height modified, but not the other"
          // cuando el className del padre fija una sola dimensión.
          style={{ width: 'auto', height: 'auto' }}
          priority
          unoptimized={src.startsWith('http')}
        />
      )}
    </Link>
  );
}

// Text-based logo alternative for situations where image doesn't fit
export function LogoText({ className, company }: { className?: string; company?: Pick<CompanyConfig, 'name' | 'tagline'> }) {
  const name = company?.name || '';
  const tagline = company?.tagline || '';
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 transition-opacity hover:opacity-80",
        className
      )}
    >
      <span className="font-display text-2xl tracking-tight text-foreground">
        {name.toUpperCase()}
      </span>
      {tagline && (
        <span className="hidden sm:inline text-xs text-muted-foreground uppercase tracking-widest">
          {tagline}
        </span>
      )}
    </Link>
  );
}
