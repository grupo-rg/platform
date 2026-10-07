'use client';

import { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, File, FileVideo, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadLeadAttachmentAction } from '@/actions/lead/upload-lead-attachment.action';

interface SimpleFileUploadProps {
    value?: string[];
    onChange: (files: string[]) => void;
    maxFiles?: number;
    accept?: Record<string, string[]>;
    description?: string;
}

export function SimpleFileUpload({
    value = [],
    onChange,
    maxFiles = 5,
    accept = {
        'image/*': [],
        'video/*': [],
        'application/pdf': []
    },
    description = "Arrastra imágenes, vídeos o PDFs aquí"
}: SimpleFileUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    // ref (gs://… privado) → { previewUrl firmada de corta duración, tipo }.
    const [previews, setPreviews] = useState<Record<string, { url?: string; kind?: string }>>({});
    const uploadSessionId = useRef<string>(
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : ''
    );

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const remainingSlots = maxFiles - value.length;
        const filesToProcess = acceptedFiles.slice(0, remainingSlots);

        if (filesToProcess.length === 0) return;

        setUploading(true);
        setUploadError(null);
        try {
            // Subida vía server action a almacenamiento PRIVADO (lead_uploads/).
            // El formulario guarda la referencia opaca; el panel la resuelve a
            // una URL firmada de corta duración.
            const newRefs: string[] = [];
            const newPreviews: Record<string, { url?: string; kind?: string }> = {};

            for (const file of filesToProcess) {
                const fd = new FormData();
                fd.append('file', file);
                fd.append('uploadSessionId', uploadSessionId.current);
                const res = await uploadLeadAttachmentAction(fd);
                if (res.success && res.ref) {
                    newRefs.push(res.ref);
                    newPreviews[res.ref] = { url: res.previewUrl, kind: res.kind };
                } else {
                    setUploadError(res.error || 'No se pudo subir un archivo.');
                }
            }

            if (newRefs.length > 0) {
                setPreviews(prev => ({ ...prev, ...newPreviews }));
                onChange([...value, ...newRefs]);
            }
        } catch (error) {
            console.error("Upload failed:", error);
            setUploadError('No se pudo subir el archivo. Inténtalo de nuevo.');
        } finally {
            setUploading(false);
        }
    }, [value, maxFiles, onChange]);

    const removeFile = (index: number) => {
        const newFiles = [...value];
        newFiles.splice(index, 1);
        onChange(newFiles);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept,
        maxFiles: maxFiles - value.length,
        disabled: value.length >= maxFiles || uploading,
        multiple: true
    });

    return (
        <div className="space-y-4">
            <div
                {...getRootProps()}
                className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors relative",
                    isDragActive ? "border-primary bg-primary/5" : "border-slate-200 hover:bg-slate-50",
                    (value.length >= maxFiles || uploading) && "opacity-50 cursor-not-allowed"
                )}
            >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2 text-slate-500">
                    {uploading ? (
                        <Loader2 className="w-8 h-8 mb-2 animate-spin text-primary" />
                    ) : (
                        <Upload className="w-8 h-8 mb-2" />
                    )}
                    <p className="font-medium">{uploading ? "Subiendo archivos..." : description}</p>
                    <p className="text-xs">Máximo {maxFiles} archivos.</p>
                </div>
            </div>
            {uploadError && <p className="text-xs text-rose-600" role="alert">{uploadError}</p>}

            {value.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {value.map((file, index) => {
                        // `file` es una referencia privada gs://… (subidas nuevas) o
                        // una URL antigua. Para las privadas usamos la preview firmada.
                        const preview = previews[file];
                        const displayUrl = preview?.url || (/^https?:\/\//.test(file) ? file : '');
                        const isVideo = preview?.kind === 'video' || /\.(mp4|mov|webm)(\?.*)?$/i.test(file);
                        const isPdf = preview?.kind === 'pdf' || /\.pdf(\?.*)?$/i.test(file);
                        const isImage = !isVideo && !isPdf;

                        return (
                            <div key={index} className="relative group aspect-square bg-slate-100 rounded-md overflow-hidden border">
                                {isImage && displayUrl && (
                                    <img
                                        src={displayUrl}
                                        alt="Uploaded file"
                                        className="w-full h-full object-cover"
                                    />
                                )}
                                {isVideo && (
                                    <div className="flex items-center justify-center h-full">
                                        <FileVideo className="w-8 h-8 text-slate-400" />
                                    </div>
                                )}
                                {isPdf && (
                                    <div className="flex items-center justify-center h-full">
                                        <File className="w-8 h-8 text-slate-400" />
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation(); // prevent triggering dropzone click
                                        removeFile(index);
                                    }}
                                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 z-10"
                                >
                                    <X className="w-4 h-4" />
                                </button>

                                {/* Link to view */}
                                {displayUrl && <a
                                    href={displayUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute bottom-1 right-1 bg-white/80 p-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto z-10 hover:bg-white text-slate-700 font-medium shadow-sm"
                                >
                                    Ver
                                </a>}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
