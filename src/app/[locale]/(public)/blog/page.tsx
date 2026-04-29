import { getDictionary } from '@/lib/dictionaries';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { constructMetadata } from '@/i18n/seo-utils';
import { WebPageJsonLd, BreadcrumbJsonLd } from '@/components/seo/json-ld';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import type { BlogLocale } from '@/backend/marketing/domain/blog-post';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

export const revalidate = 300; // ISR 5 min

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.blog;

  return constructMetadata({
    title: t.title,
    description: t.subtitle,
    path: '/blog',
    locale
  });
}

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.blog;
  const company = await companyConfigService.get();

  const posts = await blogPostService.listPublishedAll(locale as BlogLocale, 30);

  return (
    <>
      <WebPageJsonLd
        name={t.title}
        description={t.subtitle}
        url={`${company.web}/${locale}/blog`}
        type="CollectionPage"
      />
      <BreadcrumbJsonLd items={[
        { name: 'Inicio', href: `/${locale}` },
        { name: t.title || 'Blog', href: `/${locale}/blog` }
      ]} />
      <section className="w-full py-20 md:py-28 bg-secondary/50">
        <div className="container-limited text-center">
          <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
            {t.title}
          </h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            {t.subtitle}
          </p>
        </div>
      </section>

      <section className="w-full py-20 md:py-28 bg-background">
        <div className="container-limited">
          {posts.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              Aún no hemos publicado artículos. Vuelve pronto.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post) => (
                <Card key={post.id} className="group overflow-hidden flex flex-col h-full hover:shadow-xl transition-all duration-300">
                  {post.heroImageUrl && (
                    <div className="relative h-56 w-full">
                      <Image
                        src={post.heroImageUrl}
                        alt={post.title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        unoptimized={post.heroImageUrl.startsWith('http')}
                      />
                    </div>
                  )}
                  <CardContent className="p-6 flex-grow flex flex-col">
                    {post.tags?.[0] && <p className="text-sm text-primary font-semibold mb-2">{post.tags[0]}</p>}
                    <h3 className="font-headline text-xl font-bold mb-2 flex-grow">{post.title}</h3>
                    <p className="text-muted-foreground text-sm mb-4">{post.metaDescription}</p>
                    <Button asChild variant="link" className="p-0 h-auto mt-auto self-start">
                      <Link href={{ pathname: '/blog/[slug]', params: { slug: post.slug } }} className="font-bold">
                        {t.readMore} <ArrowRight className="ml-2" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="w-full py-20 md:py-28 bg-secondary/50">
        <div className="container-limited text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-bold">{t.cta.title}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mt-4 mb-8">
            {t.cta.subtitle}
          </p>
          <Button asChild size="lg" className="font-bold">
            <Link href="/budget-request">
              {t.cta.button}
              <ArrowRight className="ml-2" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
