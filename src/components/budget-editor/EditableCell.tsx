import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import {
    cn,
    formatCurrency,
    formatNumberES,
    parseNumberES,
    toEditableNumberES,
} from '@/lib/utils';

interface EditableCellProps {
    value: string | number;
    onChange: (value: string | number) => void;
    /**
     * Se dispara en cada pulsación (no sólo al blur) para campos number/currency.
     * Permite recalcular totales de partida, capítulo y global EN VIVO mientras el
     * usuario escribe, sin esperar a que el input pierda el foco. El commit final
     * (con efectos secundarios como logging RLHF) sigue ocurriendo en `onChange`.
     */
    onLiveChange?: (value: number) => void;
    type?: 'text' | 'number' | 'currency' | 'textarea';
    /** Decimales fijos al mostrar el valor. Por defecto 2 (800 → "800,00"). */
    decimals?: number;
    className?: string;
    placeholder?: string;
    isEditing?: boolean;
}

export const EditableCell = ({
    value,
    onChange,
    onLiveChange,
    type = 'text',
    decimals = 2,
    className,
    placeholder,
    isEditing = true
}: EditableCellProps) => {
    const [localValue, setLocalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    const isNumeric = type === 'number' || type === 'currency';

    // No sobreescribimos el valor local mientras el campo está enfocado: el valor
    // del prop puede recalcularse en vivo (p.ej. precio unitario derivado del total)
    // y machacaría lo que el usuario está tecleando — impidiendo escribir decimales.
    useEffect(() => {
        if (!isFocused) setLocalValue(value);
    }, [value, isFocused]);

    const handleInputChange = (raw: string) => {
        setLocalValue(raw);
        if (!onLiveChange || !isNumeric) return;
        // Evitamos commitear valores intermedios incompletos ("", "-", "10,")
        // que romperían el cálculo; esperamos a tener un número parseable.
        if (raw === '' || raw === '-' || raw.endsWith('.') || raw.endsWith(',')) return;
        onLiveChange(parseNumberES(raw));
    };

    const handleFocus = () => {
        setIsFocused(true);
        // Al entrar se edita el número "en crudo": sin millares y con coma decimal.
        if (isNumeric) setLocalValue(toEditableNumberES(value));
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (isNumeric) {
            const parsed = parseNumberES(localValue);
            if (parsed !== Number(value)) onChange(parsed);
            setLocalValue(parsed);
            return;
        }
        if (localValue !== value) onChange(localValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && type !== 'textarea') {
            inputRef.current?.blur();
        }
    };

    useEffect(() => {
        if (type === 'textarea' && inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
        }
    }, [localValue, type]);

    if (!isEditing) {
        return (
            <div className={cn("px-2 py-1 min-h-[2rem] flex items-center", className)}>
                {type === 'currency'
                    ? formatCurrency(parseNumberES(value))
                    : type === 'number'
                        ? formatNumberES(parseNumberES(value), decimals)
                        : value
                }
            </div>
        );
    }

    if (type === 'textarea') {
        return (
            <textarea
                ref={inputRef as any}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                className={cn(
                    "w-full bg-transparent border-0 ring-0 focus:ring-2 focus:ring-primary/20 rounded p-1 resize-none overflow-hidden",
                    className
                )}
                placeholder={placeholder}
                rows={1}
            />
        );
    }

    // Fuera del foco se muestra el número ya formateado ("800,00"); al enfocar se
    // cambia al texto editable. Por eso el input es `text` + `inputMode=decimal`:
    // un `type=number` no acepta la coma decimal ni los puntos de millar.
    const displayValue = isNumeric && !isFocused
        ? formatNumberES(parseNumberES(value), decimals)
        : (Number.isNaN(localValue as any) ? '' : localValue);

    return (
        <div className="relative flex items-center justify-end w-full">
            <Input
                ref={inputRef as any}
                type={isNumeric ? 'text' : type}
                inputMode={isNumeric ? 'decimal' : undefined}
                value={displayValue as string | number}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={handleBlur}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                className={cn(
                    "flex-1 min-w-0 h-8 border-transparent hover:border-input focus:border-primary bg-transparent py-1 px-2 shadow-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                    isFocused && "bg-white dark:bg-zinc-900",
                    className
                )}
                placeholder={placeholder}
            />
            {type === 'currency' && (
                <span className="shrink-0 text-xs text-slate-500 font-medium pl-1 pointer-events-none mt-[1px]">€</span>
            )}
        </div>
    );
};
