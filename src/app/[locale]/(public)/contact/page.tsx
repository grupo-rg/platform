import { getDictionary } from '@/lib/dictionaries';
import { Button } from '@/components/ui/button';
import { Mail, MapPin, Phone, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { WebPageJsonLd, BreadcrumbJsonLd } from '@/components/seo/json-ld';
import { SmartTriggerButton } from '@/components/contact/SmartTriggerButton';
import * as motion from 'framer-motion/client';

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.contact;

  const contactDetails = [
    {
      icon: <MapPin className="h-5 w-5" />,
      label: t.address.label,
      value: t.address.value || "Petra, Mallorca",
      description: "Nuestras oficinas centrales",
    },
    {
      icon: <Phone className="h-5 w-5" />,
      label: t.phone.label,
      value: "+34 674 26 69 69",
      description: "Lunes a Viernes, 9:00 - 18:00",
    },
    {
      icon: <Mail className="h-5 w-5" />,
      label: t.email.label,
      value: "info@gruporg.com",
      description: "Respuesta en menos de 24h",
    },
  ];

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)]">
      <WebPageJsonLd
        name={t.hero.title}
        description={t.hero.description}
        url={`${process.env.NEXT_PUBLIC_SITE_URL}/${locale}/contact`}
        type="ContactPage"
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: t.hero.title, href: "/contact" },
        ]}
      />

      {/* Hero Section */}
      <section className="relative w-full py-24 md:py-32 overflow-hidden bg-background">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--primary)_0%,_transparent_70%)]" />
        </div>

        <div className="container-limited relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-3xl"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold tracking-widest uppercase mb-6">
              {t.hero.badge || "Contacto"}
            </span>
            <h1 className="heading-display text-5xl md:text-7xl lg:text-8xl mb-8 leading-[0.9] text-foreground">
              {t.hero.title.split(' ').map((word: string, i: number) => (
                <span key={i} className="inline-block mr-4">
                  {word === "ayudarte" || word === "help" ? (
                    <span className="text-primary italic font-serif italic">{word}</span>
                  ) : word}
                </span>
              ))}
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground font-light leading-relaxed max-w-2xl">
              {t.hero.description}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Content */}
      <section className="w-full pb-24 bg-background">
        <div className="container-limited">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Contact Info Cards */}
            <div className="lg:col-span-4 space-y-6">
              {contactDetails.map((detail, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + (index * 0.1) }}
                  className="group p-8 rounded-3xl bg-secondary/30 border border-border/50 backdrop-blur-sm hover:border-primary/50 hover:bg-secondary/50 transition-all duration-500"
                >
                  <div className="flex items-start gap-5">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500">
                      {detail.icon}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
                        {detail.label}
                      </p>
                      <p className="text-lg font-medium text-foreground mb-1">
                        {detail.value}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {detail.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Map Section */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4 }}
              className="lg:col-span-8 h-[500px] lg:h-[600px] rounded-[3rem] overflow-hidden border border-border/50 shadow-2xl relative grayscale hover:grayscale-0 transition-all duration-1000 group"
            >
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d12318.513481232811!2d3.1028782!3d39.613915!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12964bfa95f33663%3A0xc6cb511993214e6b!2s07520%20Petra%2C%20Balearic%20Islands!5e0!3m2!1sen!2ses!4v1700000000000!5m2!1sen!2ses"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen={false}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Petra, Mallorca"
                className="grayscale hover:grayscale-0 transition-all duration-500 scale-[1.01] group-hover:scale-105"
              />
              <div className="absolute inset-0 pointer-events-none border-[12px] border-background/50 rounded-[3rem]" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-24 mb-24 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center opacity-10">
          <div className="w-[800px] h-[800px] bg-white rounded-full blur-[120px]" />
        </div>

        <div className="container-limited relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto"
          >
            <h2 className="heading-display text-4xl md:text-6xl mb-8 leading-tight">
              {t.cta?.title || "¿Listo para transformar tu espacio?"}
            </h2>
            <p className="text-lg md:text-xl opacity-90 mb-10 font-light">
              {t.cta?.subtitle || "Agenda una consulta gratuita y descubre cómo podemos hacer realidad tu visión."}
            </p>
            <SmartTriggerButton
              label={t.cta?.buttonPrimary || "Solicitar Presupuesto"}
              className="bg-white text-primary hover:bg-stone-100 rounded-full px-10 py-7 text-lg font-bold"
            />          </motion.div>
        </div>
      </section>
    </div>
  );
}
