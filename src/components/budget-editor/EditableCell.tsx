import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn, formatCurrency } from '@/lib/utils';

interface EditableCellProps {
    value: string | number;
    onChange: (value: string | number) => void;
    type?: 'text' | 'number' | 'currency' | 'textarea';
    className?: string;
    placeholder?: string;
    isEditing?: boolean;
}

export const EditableCell = ({
    value,
    onChange,
    type = 'text',
    className,
    placeholder,
    isEditing = true
}: EditableCellProps) => {
    const [localValue, setLocalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = () => {
        setIsFocused(false);
        if (localValue !== value) {
            onChange(type === 'number' || type === 'currency' ? Number(localValue) : localValue);
        }
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
                    ? formatCurrency(Number(value))
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

    return (
        <div className="relative flex items-center justify-end w-full">
            <Input
                ref={inputRef as any}
                type={type === 'currency' ? 'number' : type}
                value={Number.isNaN(localValue) ? '' : localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                onFocus={() => setIsFocused(true)}
                onKeyDown={handleKeyDown}
                className={cn(
                    "flex-1 min-w-0 h-8 border-transparent hover:border-input focus:border-primary bg-transparent py-1 px-2 shadow-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                    isFocused && "bg-white dark:bg-zinc-900",
                    className
                )}
                placeholder={placeholder}
                step={type === 'currency' ? "0.01" : "1"}
            />
            {type === 'currency' && (
                <span className="shrink-0 text-xs text-slate-500 font-medium pl-1 pointer-events-none mt-[1px]">€</span>
            )}
        </div>
    );
};
