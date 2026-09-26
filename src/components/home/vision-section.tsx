'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';

import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { useRef, useState } from 'react';
import { ShieldCheck, MonitorPlay, Clock, Gem, Play, X, Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog';

export function VisionSection({ t }: { t: any }) {
    const [isVideoOpen, setIsVideoOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const videoUrl = "https://firebasestorage.googleapis.com/v0/b/local-digital-eye.firebasestorage.app/o/business%2FGRUPO RG%2Fexpress_corporativo.mp4?alt=media&token=3916f648-aa3a-4b9c-9f62-17e9ff8ff74d"

    const ref = useRef(null);
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start end", "end start"]
    });

    const y1 = useTransform(scrollYProgress, [0, 1], [100, -100]);
    const y2 = useTransform(scrollYProgress, [0, 1], [0, -50]);

    if (!t) return null;

    const icons = [
        <ShieldCheck className="h-6 w-6 text-primary" key="0" />,
        <MonitorPlay className="h-6 w-6 text-primary" key="1" />,
        <Clock className="h-6 w-6 text-primary" key="2" />,
        <Gem className="h-6 w-6 text-primary" key="3" />
    ];

    const handleVideoClick = () => {
        setIsVideoOpen(true);
    };

    return (
        <section ref={ref} className="py-32 bg-background relative overflow-hidden">
            {/* Decorative background elements */}
            <div className="absolute top-20 left-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -z-10" />
            <div className="absolute bottom-20 right-0 w-[500px] h-[500px] bg-secondary/10 rounded-full blur-3xl -z-10" />

            <div className="container-limited grid lg:grid-cols-12 gap-12 items-center">

                {/* Text Content - Spans 5 columns */}
                <motion.div
                    initial={{ opacity: 0, x: -50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8 }}
                    className="lg:col-span-5 space-y-10 relative z-10"
                >
                    <div className="space-y-4">
                        <div className="inline-block relative">
                            <span className="text-primary font-bold tracking-widest uppercase text-xs md:text-sm">{t.label}</span>
                            <span className="absolute -bottom-2 left-0 w-1/2 h-[2px] bg-primary" />
                        </div>
                        <h2
                            className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[1.1]"
                            dangerouslySetInnerHTML={{ __html: t.title }}
                        />
                    </div>

                    <p className="text-lg text-muted-foreground leading-relaxed font-light">
                        {t.description}
                    </p>

                    {/* Value Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {t.points.map((item: string, index: number) => (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                                className="group bg-card border border-border/40 hover:border-primary/50 p-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 flex items-start gap-3"
                            >
                                <div className="mt-1 p-2 bg-secondary/50 rounded-lg group-hover:bg-primary/10 transition-colors">
                                    {icons[index] || <ShieldCheck className="h-5 w-5 text-primary" />}
                                </div>
                                <span className="text-sm font-medium text-foreground/90 group-hover:text-primary transition-colors">
                                    {item}
                                </span>
                            </motion.div>
                        ))}
                    </div>

                    <div className="pt-6">
                        <Button onClick={handleVideoClick} className="bg-foreground text-background hover:bg-primary hover:text-white transition-all duration-300 rounded-full px-8 py-6 text-lg shadow-lg hover:shadow-xl hover:-translate-y-1 gap-2">
                            <Play className="w-5 h-5 fill-current" /> Ver Historia Completa
                        </Button>
                    </div>
                </motion.div>

                {/* Visuals - Spans 7 columns with Parallax */}
                <div className="lg:col-span-1 hidden lg:block" /> {/* Spacer */}
                <div className="lg:col-span-6 relative h-[600px] lg:h-[700px] w-full">
                    {/* Main Image */}
                    <motion.div
                        style={{ y: y1 }}
                        className="absolute right-0 top-0 w-[85%] h-[80%] rounded-[2rem] overflow-hidden shadow-2xl z-10 bg-black"
                    >
                        {/* Video Thumbnail / Preview */}
                        <div className="relative w-full h-full group cursor-pointer" onClick={handleVideoClick}>
                            <video
                                src={videoUrl}
                                className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity duration-500"
                                autoPlay
                                muted
                                loop
                                playsInline
                            />
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-500" />

                            {/* Play Button Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30 group-hover:scale-110 transition-transform duration-300">
                                    <Play className="w-8 h-8 text-white fill-white ml-1" />
                                </div>
                            </div>

                            <div className="absolute bottom-8 left-8 text-white">
                                <span className="uppercase text-xs font-bold tracking-widest mb-1 block">Corporate Film</span>
                                <h3 className="text-2xl font-headline font-bold">Nuestra Esencia</h3>
                            </div>
                        </div>
                    </motion.div>

                    {/* Secondary Image/Detail - Replaced with a detail shot but keeping structure */}
                    <motion.div
                        style={{ y: y2 }}
                        className="absolute left-0 bottom-10 w-[55%] h-[45%] rounded-[1.5rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.2)] z-20 border-4 border-background bg-zinc-900"
                    >
                        <Image
                            src="/images/luxury-detail.png" // Still using image here to contrast with video
                            alt="Architectural Plan"
                            fill
                            className="object-cover grayscale hover:grayscale-0 transition-all duration-700"
                        />
                    </motion.div>

                    {/* Signature Badge */}
                    <motion.div
                        initial={{ scale: 0, rotate: -20 }}
                        whileInView={{ scale: 1, rotate: 0 }}
                        viewport={{ once: true }}
                        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.5 }}
                        className="absolute right-10 bottom-32 z-30 bg-background/90 backdrop-blur-md px-6 py-4 rounded-xl shadow-lg border border-primary/20"
                    >
                        <div className="text-center">
                            <span className="block font-headline font-bold text-2xl text-primary">25+</span>
                            <span className="text-xs uppercase tracking-widest text-muted-foreground">Years of <br /> Excellence</span>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Full Screen Video Modal */}
            <AnimatePresence>
                {isVideoOpen && (
                    <Dialog open={isVideoOpen} onOpenChange={setIsVideoOpen}>
                        <DialogContent className="max-w-[90vw] h-[90vh] p-0 border-none bg-black/95 text-white overflow-hidden">
                            <DialogTitle className="sr-only">Video Corporativo: Nuestra Esencia</DialogTitle>
                            <div className="relative w-full h-full flex items-center justify-center">
                                <button
                                    onClick={() => setIsVideoOpen(false)}
                                    aria-label="Cerrar vídeo"
                                    className="absolute top-4 right-4 z-50 p-2 bg-black/50 rounded-full hover:bg-white/20 transition-colors"
                                >
                                    <X className="w-6 h-6" aria-hidden="true" />
                                </button>
                                <video
                                    src={videoUrl}
                                    className="w-full h-full max-h-screen object-contain"
                                    controls
                                    autoPlay
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </AnimatePresence>
        </section>
    );
}
