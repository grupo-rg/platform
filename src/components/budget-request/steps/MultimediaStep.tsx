import { UseFormReturn } from 'react-hook-form';
import { DetailedFormValues } from '../schema';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Image as ImageIcon } from 'lucide-react';
import { SimpleFileUpload } from '@/components/ui/simple-file-upload';

interface MultimediaStepProps {
    form: UseFormReturn<DetailedFormValues>;
    t: any;
}

export const MultimediaStep = ({ form }: MultimediaStepProps) => {
    return (
        <div className="space-y-6 text-left">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <h3 className="flex items-center gap-2 font-semibold text-blue-900">
                    <ImageIcon className="w-5 h-5" />
                    Estado actual y documentación
                </h3>
                <p className="text-sm text-blue-700 mt-1">
                    Sube fotos de las estancias a reformar y, si las tienes, planos o estados de mediciones en PDF.
                </p>
            </div>

            <FormField
                control={form.control}
                name="files"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <SimpleFileUpload
                                value={field.value || []}
                                onChange={field.onChange}
                                maxFiles={5}
                                accept={{
                                    'image/*': [],
                                    'application/pdf': [],
                                }}
                                description="Arrastra fotos o PDFs aquí, o haz clic para seleccionar"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
};
