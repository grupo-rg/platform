import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getDictionary } from '@/lib/dictionaries';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ArrowRight, Calendar, Tag } from 'lucide-react';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import { constructMetadata } from '@/i18n/seo-utils';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import type { BlogLocale } from '@/backend/marketing/domain/blog-post';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  // Pre-renderizar solo el set en español en build; otros locales se generan on-demand.
  const posts = await blogPostService.listPublishedAll('es', 50).catch(() => []);
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }): Promise<Metadata> {
  const { slug, locale } = await params;
  const post = await blogPostService.findBySlug(locale as BlogLocale, slug);
  if (!post) return {};

  const company = await companyConfigService.get();

  return constructMetadata({
    title: post.metaTitle ? `${post.metaTitle} | ${company.name}` : `${post.title} | ${company.name}`,
    description: post.metaDescription,
    image: post.ogImageUrl || post.heroImageUrl,
    path: '/blog/[slug]',
    locale,
    params: { slug },
    type: 'article'
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string, locale: any }> }) {
  const { slug, locale } = await params;
  const post = await blogPostService.findBySlug(locale as BlogLocale, slug);
  const dict = await getDictionary(locale);
  const t_cta = dict.blog.cta;

  if (!post) {
    notFound();
  }

  return (
    <>
      <Header t={dict} />
      <main className="flex-1">
        {post.heroImageUrl && (
          <section className="relative h-64 md:h-80 w-full">
            <Image
              src={post.heroImageUrl}
              alt={`Imagen representativa de ${post.title}`}
              fill
              className="object-cover"
              unoptimized={post.heroImageUrl.startsWith('http')}
            />
            <div className="absolute inset-0 bg-black/50" />
          </section>
        )}

        <section className="py-16 md:py-24">
          <div className="container-limited">
            <article className="prose dark:prose-invert max-w-none mx-auto lg:max-w-4xl">
              <div className="mb-8 text-center">
                <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground mb-2">
                  {post.tags?.[0] && (
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4" />
                      <span className="font-semibold text-primary">{post.tags[0]}</span>
                    </div>
                  )}
                  {post.publishedAt && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>{new Date(post.publishedAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                    </div>
                  )}
                </div>
                <h1 className="font-headline text-4xl md:text-5xl font-bold !mb-4">
                  {post.title}
                </h1>
              </div>
              <ReactMarkdown>{post.contentMarkdown}</ReactMarkdown>
            </article>
          </div>
        </section>

        <section className="w-full py-20 md:py-28 bg-secondary/50">
          <div className="container-limited text-center">
            <h2 className="font-headline text-3xl md:text-4xl font-bold">{t_cta.postCta.title}</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mt-4 mb-8">
              {t_cta.postCta.subtitle}
            </p>
            <Button asChild size="lg" className="font-bold">
              <Link href="/budget-request">
                {t_cta.button}
                <ArrowRight className="ml-2" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer t={dict.home.finalCta} />
    </>
  );
}
