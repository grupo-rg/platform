'use client';

import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
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
              <SheetContent
                side="right"
                className="flex w-[88vw] max-w-[380px] flex-col gap-0 border-l border-border/40 bg-background p-0 sm:max-w-[380px]"
              >
                <SheetHeader className="shrink-0 border-b border-border/40 px-6 py-5 text-left">
                  <SheetTitle className="sr-only">Menú</SheetTitle>
                  {/* El logo es amarillo: sobre fondo claro se pinta en negro y sobre oscuro en blanco. */}
                  <Logo className="h-8 dark:hidden" variant="dark" width={110} height={32} />
                  <Logo className="hidden h-8 dark:block" variant="light" width={110} height={32} />
                </SheetHeader>
                <MobileMenu
                  t={t}
                  onLinkClick={handleLinkClick}
                  user={user}
                />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
