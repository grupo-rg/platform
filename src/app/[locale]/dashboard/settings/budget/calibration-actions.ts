'use server';

import { revalidatePath } from 'next/cache';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { CalibrationService } from '@/backend/calibration/application/calibration-service';
import { FirestoreCalibrationRepository } from '@/backend/calibration/infrastructure/firestore-calibration.repository';
import { CalibrationFactors, CalibrationGuard } from '@/backend/calibration/domain/calibration-factors';

const service = new CalibrationService(new FirestoreCalibrationRepository());

const SETTINGS_PATH = '/dashboard/settings/budget';

/** Admin gate — throws (never returns null downstream) so the UI surfaces the error. */
async function requireAdmin(): Promise<string> {
    const auth = await verifyAuth(true);
    if (!auth) throw new Error('unauthorized');
    return auth.email || auth.userId;
}

export async function getCalibrationFactorsAction(): Promise<CalibrationFactors> {
    await requireAdmin();
    try {
        return await service.getFactors();
    } catch (error) {
        console.error('[calibration] getCalibrationFactorsAction failed:', error);
        throw new Error('Failed to fetch calibration factors');
    }
}

export async function saveCalibrationGlobalAction(factor: number): Promise<CalibrationFactors> {
    const updatedBy = await requireAdmin();
    try {
        const result = await service.setGlobalFactor(factor, updatedBy);
        revalidatePath(SETTINGS_PATH);
        return result;
    } catch (error) {
        console.error('[calibration] saveCalibrationGlobalAction failed:', error);
        throw new Error('Failed to save global calibration factor');
    }
}

export async function saveCalibrationChapterAction(
    chapterName: string,
    manualFactor: number,
    manualLocked: boolean,
): Promise<CalibrationFactors> {
    const updatedBy = await requireAdmin();
    try {
        const result = await service.setChapterManual(
            chapterName,
            { manualFactor, manualLocked },
            updatedBy,
        );
        revalidatePath(SETTINGS_PATH);
        return result;
    } catch (error) {
        console.error('[calibration] saveCalibrationChapterAction failed:', error);
        throw new Error('Failed to save chapter calibration factor');
    }
}

export async function setCalibrationChapterLockAction(
    chapterName: string,
    locked: boolean,
): Promise<CalibrationFactors> {
    const updatedBy = await requireAdmin();
    try {
        const result = await service.setChapterLock(chapterName, locked, updatedBy);
        revalidatePath(SETTINGS_PATH);
        return result;
    } catch (error) {
        console.error('[calibration] setCalibrationChapterLockAction failed:', error);
        throw new Error('Failed to update chapter lock');
    }
}

export async function resetCalibrationChapterAction(
    chapterName: string,
): Promise<CalibrationFactors> {
    const updatedBy = await requireAdmin();
    try {
        const result = await service.resetChapterToGlobal(chapterName, updatedBy);
        revalidatePath(SETTINGS_PATH);
        return result;
    } catch (error) {
        console.error('[calibration] resetCalibrationChapterAction failed:', error);
        throw new Error('Failed to reset chapter calibration');
    }
}

export async function saveCalibrationGuardAction(
    guard: Partial<CalibrationGuard>,
): Promise<CalibrationFactors> {
    const updatedBy = await requireAdmin();
    try {
        const result = await service.setGuard(guard, updatedBy);
        revalidatePath(SETTINGS_PATH);
        return result;
    } catch (error) {
        console.error('[calibration] saveCalibrationGuardAction failed:', error);
        throw new Error('Failed to save calibration guard');
    }
}
