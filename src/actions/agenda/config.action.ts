'use server';

import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { AvailabilityConfig } from '@/backend/agenda/domain/availability-config';

const availabilityRepo = new FirestoreAvailabilityRepository();

export async function getAvailabilityConfigAction(): Promise<AvailabilityConfig> {
    const config = await availabilityRepo.getConfig();
    // Return a plain object to avoid serialization issues across server boundaries
    return {
        id: config.id,
        weekSchedule: config.weekSchedule,
        slotDurationMinutes: config.slotDurationMinutes,
        bufferMinutes: config.bufferMinutes,
        updatedAt: config.updatedAt
    } as AvailabilityConfig;
}

export async function updateAvailabilityConfigAction(
    data: {
        weekSchedule: AvailabilityConfig['weekSchedule'],
        slotDurationMinutes: number,
        bufferMinutes: number
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const current = await availabilityRepo.getConfig();
        const updated = new AvailabilityConfig(
            current.id,
            data.weekSchedule,
            data.slotDurationMinutes,
            data.bufferMinutes,
            new Date()
        );
        await availabilityRepo.save(updated);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
