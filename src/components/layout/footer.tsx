import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

export async function Footer({ t }: { t?: any }) {
  const currentYear = new Date().getFullYear();
  const company = await companyConfigService.get();
  return (
    <footer className="w-full bg-[#0a0a0a] text-foreground border-t border-border">
      <div className="container mx-auto px-4 md:px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8 items-start text-center md:text-left">
          {/* Logo & Hook */}
          <div className="flex flex-col items-center md:items-start gap-4">
            <Logo variant="light" className="mb-2" width={120} height={40} company={company} />
            {company.tagline && (
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                {company.tagline}
              </p>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              {company.address && <p>{company.address}</p>}
              {company.phone && <p>{company.phone}</p>}
              {company.email && <p>{company.email}</p>}
            </div>
          </div>

          {/* Legal Links */}
          <div className="flex flex-col gap-2 items-center">
            <h4 className="font-headline font-semibold text-primary mb-2">Legal</h4>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Política de Privacidad</Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">Términos de Servicio</Link>
          </div>

          {/* Copyright */}
          <div className="flex flex-col items-center md:items-end gap-4">
            <p className="text-sm text-muted-foreground">&copy; {currentYear} {company.legalName || company.name}.</p>
            {company.cif && <p className="text-xs text-muted-foreground">CIF: {company.cif}</p>}
          </div>
        </div>
      </div>
    </footer>
  );
}
