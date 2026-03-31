'use client';

import Image from 'next/image';
import { BudgetWidget } from '@/components/budget-widget';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { UserNav } from '@/components/auth/user-nav';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Menu } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MegaMenu } from './mega-menu';
import { MobileMenu } from './mobile-menu';

export function Header({ t }: { t: any }) {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: { pathname: '/', hash: 'wizard' }, label: "Asistente Costes" },
    { href: '/', label: "Plataforma" },
    { href: '/', label: "Casos de Uso" },
  ];

  const handleLinkClick = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-500 ease-in-out h-[10vh] flex items-center",
        isScrolled
          ? "border-b border-primary/10 bg-background/80 backdrop-blur-md shadow-sm"
          : "bg-transparent border-transparent"
      )}
    >
      <div className="w-[85vw] max-w-[1920px] mx-auto flex h-full items-center justify-between transition-all duration-300">
        <div className={cn("transition-transform duration-300 flex-shrink-0", isScrolled ? "scale-90" : "scale-100")}>
          <Logo className="h-8 flex items-center" width={110} height={32} />
        </div>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center justify-center flex-1 mx-8">
          <MegaMenu t={t} />
        </div>

        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <LanguageSwitcher />
          
          {/* Mobile Navigation */}
          <div className="lg:hidden flex items-center">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="hover:bg-primary/10 relative z-50">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] p-0 border-l border-border/40 bg-background/95 backdrop-blur-lg">
                <SheetHeader className="px-6 py-4 border-b border-border/40">
                  <SheetTitle className="sr-only">Menú Móvil</SheetTitle>
                  <Logo className="h-8" width={110} height={32} />
                </SheetHeader>
                <div className="overflow-y-auto max-h-[calc(100vh-80px)]">
                  <MobileMenu
                    t={t}
                    navLinks={navLinks}
                    onLinkClick={handleLinkClick}
                    user={user}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
