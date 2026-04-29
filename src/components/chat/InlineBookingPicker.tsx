'use client';

import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { CalendarCheck2, CheckCircle2, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confirmBookingFromChatAction } from '@/actions/agenda/confirm-booking-from-chat.action';

export interface BookingSlot {
    date: string;
    startTime: string;
    endTime: string;
    label: string;
}

interface Props {
    leadId: string;
    slots: BookingSlot[];
    onConfirmed?: (slot: BookingSlot, bookingId: string) => void;
}

/**
 * Renderiza una fila de chips con los próximos slots disponibles, debajo
 * de la respuesta del agente cuando un lead se cualifica. Click en un chip
 * pide confirmación y agenda la reunión.
 */
export function InlineBookingPicker({ leadId, slots, onConfirmed }: Props) {
    const [isPending, startTransition] = useTransition();
    const [confirmed, setConfirmed] = useState<{ slot: BookingSlot; bookingId: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pickedSlot, setPickedSlot] = useState<BookingSlot | null>(null);

    if (confirmed) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>
                    ¡Reunión agendada! <strong>{confirmed.slot.label}</strong>. Te enviamos un email de confirmación.
                </span>
            </motion.div>
        );
    }

    function handleClick(slot: BookingSlot) {
        if (isPending) return;
        setPickedSlot(slot);
        setError(null);
        startTransition(async () => {
            const res = await confirmBookingFromChatAction({
                leadId,
                date: slot.date,
                timeSlot: slot.startTime,
            });
            if (res.success && res.bookingId) {
                setConfirmed({ slot, bookingId: res.bookingId });
                onConfirmed?.(slot, res.bookingId);
            } else {
                setError(res.error || 'No se pudo agendar. Inténtalo con otro horario.');
                setPickedSlot(null);
            }
        });
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-3 space-y-2"
        >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <CalendarCheck2 className="h-3.5 w-3.5" />
                Agenda tu videollamada de 15 min:
            </div>
            <div className="flex flex-wrap gap-1.5">
                {slots.map(slot => {
                    const isThisOne = pickedSlot?.date === slot.date && pickedSlot?.startTime === slot.startTime;
                    const disabled = isPending && !isThisOne;
                    return (
                        <button
                            key={`${slot.date}-${slot.startTime}`}
                            onClick={() => handleClick(slot)}
                            disabled={isPending}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                                'border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10',
                                disabled && 'opacity-50',
                                isPending && isThisOne && 'border-primary bg-primary text-primary-foreground'
                            )}
                        >
                            {isPending && isThisOne ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Clock className="h-3 w-3" />
                            )}
                            {slot.label}
                        </button>
                    );
                })}
            </div>
            {error && (
                <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
            )}
        </motion.div>
    );
}
