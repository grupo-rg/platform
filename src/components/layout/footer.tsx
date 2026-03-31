
import { Link } from '@/i18n/navigation';
import Image from 'next/image';
import { Logo } from '@/components/logo';

export function Footer({ t }: { t?: any }) {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="w-full bg-[#0a0a0a] text-foreground border-t border-border">
      <div className="container mx-auto px-4 md:px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8 items-center text-center md:text-left">
          {/* Logo & Hook */}
          <div className="flex flex-col items-center md:items-start gap-4">
            <Logo variant="light" className="mb-2" width={120} height={40} />
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Software Core A Medida para Constructoras. Automatiza presupuestos y protege tu rentabilidad en tiempo real.
            </p>
          </div>

          {/* Legal Links */}
          <div className="flex flex-col gap-2 items-center">
            <h4 className="font-headline font-semibold text-primary mb-2">Legal</h4>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Política de Privacidad</Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">Términos de Servicio</Link>
          </div>

          {/* Copyright */}
          <div className="flex flex-col items-center md:items-end gap-4">
            <p className="text-sm text-muted-foreground">&copy; {currentYear} Basis Tech.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
