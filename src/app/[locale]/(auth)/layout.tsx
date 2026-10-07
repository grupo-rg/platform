import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Acceso privado: ni login ni invitaciones deben aparecer en buscadores.
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="min-h-screen flex flex-col">
             <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center">
                    <Logo />
                </div>
            </header>
            <main className="flex-1 flex items-center justify-center p-4">
                <div className="relative w-full max-w-md">
                     <Link href="/" className="absolute -top-16 left-0 flex items-center text-sm text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Volver a la web
                    </Link>
                    {children}
                </div>
            </main>
        </div>
    )
}
