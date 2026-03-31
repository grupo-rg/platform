export interface TimeRange {
    start: string; // e.g., "09:00"
    end: string;   // e.g., "12:30"
}

export interface DaySchedule {
    enabled: boolean;
    slots: TimeRange[];
}

/**
 * Domain Aggregate Root: AvailabilityConfig
 * Singleton document managing admin availability.
 */
export class AvailabilityConfig {
    constructor(
        public readonly id: string, // Typically 'default'
        public weekSchedule: Record<number, DaySchedule>, // 0 = Sunday, 1 = Monday, etc.
        public slotDurationMinutes: number, // e.g., 30 or 60
        public bufferMinutes: number, // e.g., 15 (gap between meetings)
        public updatedAt: Date
    ) { }

    static createDefault(id: string = 'default'): AvailabilityConfig {
        const defaultWeekSchedule: Record<number, DaySchedule> = {};

        // Disable weekends by default
        for (let i = 0; i <= 6; i++) {
            const isWeekday = i !== 0 && i !== 6;
            defaultWeekSchedule[i] = {
                enabled: isWeekday,
                slots: isWeekday ? [
                    { start: "09:00", end: "13:30" },
                    { start: "16:00", end: "19:00" }
                ] : []
            };
        }

        return new AvailabilityConfig(
            id,
            defaultWeekSchedule,
            30,
            0,
            new Date()
        );
    }
}
