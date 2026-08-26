'use client';

import { useState } from 'react';
import { Phone, X } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { CONTACT_PHONE_E164, CONTACT_WHATSAPP_URL } from '@/lib/contact';

export function ContactFab() {
  const [isOpen, setIsOpen] = useState(false);
  const phoneNumber = CONTACT_PHONE_E164;
  const whatsappLink = CONTACT_WHATSAPP_URL;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="relative flex flex-col items-center gap-2">
        {isOpen && (
          <>
            <div className="flex flex-col items-center gap-2">
              <Button asChild variant="outline" size="sm" className="bg-background text-xs px-3 h-auto py-1">
                 <Link href={`tel:${phoneNumber}`}>Llamar Ahora</Link>
              </Button>
              <Button asChild size="icon" className="rounded-full w-12 h-12 bg-blue-600 hover:bg-blue-700">
                <Link href={`tel:${phoneNumber}`} aria-label="Llamar">
                  <Phone className="h-6 w-6" />
                </Link>
              </Button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Button asChild variant="outline" size="sm" className="bg-background text-xs px-3 h-auto py-1">
                 <Link href={whatsappLink} target="_blank" rel="noopener noreferrer">WhatsApp</Link>
              </Button>
               <Button asChild size="icon" className="rounded-full w-12 h-12 bg-teal-500 hover:bg-teal-600">
                <Link href={whatsappLink} target="_blank" rel="noopener noreferrer" aria-label="Contactar por WhatsApp">
                  <FaWhatsapp className="h-6 w-6" />
                </Link>
              </Button>
            </div>
          </>
        )}
        <Button
          size="icon"
          className={cn(
            'rounded-full w-16 h-16 shadow-lg transition-transform duration-300',
            isOpen && 'rotate-45'
          )}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Cerrar opciones de contacto' : 'Abrir opciones de contacto'}
        >
          <X className={cn('h-7 w-7 transition-opacity', !isOpen && 'opacity-0')} />
          <Phone className={cn('h-7 w-7 absolute transition-opacity', isOpen && 'opacity-0')} />
        </Button>
      </div>
    </div>
  );
}
