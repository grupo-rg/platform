'use client';

import { useState, useEffect } from 'react';
import { getAdminBookingsAction } from '@/actions/agenda/booking.action';
import { ChevronLeft, ChevronRight, Calendar, User, Clock, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function BookingCalendar() {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [bookings, setBookings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBookings();
    }, [currentMonth]);

    const loadBookings = async () => {
        setLoading(true);
        try {
            // Fetch bookings for the current month view (padded slightly)
            const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
            start.setDate(start.getDate() - 7);

            const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
            end.setDate(end.getDate() + 7);

            const data = await getAdminBookingsAction(start.toISOString(), end.toISOString());
            setBookings(data || []);
        } catch (error) {
            console.error('Failed to load bookings:', error);
        } finally {
            setLoading(false);
        }
    };

    const nextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    const prevMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const today = () => {
        setCurrentMonth(new Date());
    };

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    // Generate Calendar Grid
    const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    let startingDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6; // Make Monday 0

    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();

    const calendarCells = [];

    // Pad previous month days
    for (let i = 0; i < startingDayOfWeek; i++) {
        calendarCells.push({ date: null, isCurrentMonth: false });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const dateObj = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
        const dateKey = dateObj.toISOString().split('T')[0];
        const dayBookings = bookings.filter(b => b.date.startsWith(dateKey));
        calendarCells.push({ date: i, dateKey, dateObj, isCurrentMonth: true, bookings: dayBookings });
    }

    // Pad next month
    const remainingCells = (7 - (calendarCells.length % 7)) % 7;
    for (let i = 0; i < remainingCells; i++) {
        calendarCells.push({ date: null, isCurrentMonth: false });
    }

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'CONFIRMED': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
            case 'PENDING': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
            case 'CANCELLED': return 'bg-red-500/10 text-red-600 border-red-500/20';
            default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'CONFIRMED': return 'Confirmada';
            case 'PENDING': return 'Pendiente';
            case 'CANCELLED': return 'Cancelada';
            default: return status;
        }
    };

    const isToday = (dateObj: Date) => {
        const now = new Date();
        return dateObj.getDate() === now.getDate() &&
            dateObj.getMonth() === now.getMonth() &&
            dateObj.getFullYear() === now.getFullYear();
    };

    return (
        <div className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden animate-in fade-in duration-500">
            <div className="p-6 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold font-headline flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-primary" />
                        {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                    </h2>
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-2 bg-secondary/30 p-1 rounded-xl">
                    <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8 rounded-lg hover:bg-background shadow-sm">
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={today} className="h-8 px-3 rounded-lg hover:bg-background shadow-sm text-sm font-medium">
                        Hoy
                    </Button>
                    <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8 rounded-lg hover:bg-background shadow-sm">
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-7 border-b border-border bg-muted/20">
                {dayNames.map(day => (
                    <div key={day} className="py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {day}
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-7 grid-rows-5 bg-border gap-px">
                {calendarCells.map((cell, idx) => (
                    <div
                        key={idx}
                        className={`min-h-[120px] bg-card p-2 flex flex-col ${!cell.isCurrentMonth ? 'opacity-30 bg-muted/10' : ''}`}
                    >
                        {cell.isCurrentMonth && (
                            <div className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-2 
                                ${isToday(cell.dateObj!) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                                {cell.date}
                            </div>
                        )}

                        <div className="flex-1 space-y-1.5 overflow-y-auto custom-scrollbar pr-1">
                            {cell.bookings?.map((b: any) => (
                                <div key={b.id} className={`p-2 rounded-lg border text-xs flex flex-col gap-1 transition-all hover:shadow-sm ${getStatusStyle(b.status)}`}>
                                    <div className="flex items-center justify-between font-semibold">
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {b.timeSlot}</span>
                                    </div>
                                    <div className="flex items-center gap-1 font-medium truncate" title={b.name}>
                                        <User className="w-3 h-3 flex-shrink-0 opacity-70" /> {b.name}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border-t border-border bg-muted/10 text-sm">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Sesiones Confirmadas</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500"></div> Sesiones Pendientes</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div> Sesiones Canceladas</div>
            </div>
        </div>
    );
}
