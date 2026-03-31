import { AvailabilityConfig } from './availability-config';

export interface AvailabilityRepository {
    /**
     * Get the global availability configuration.
     * Should create and return default config if it doesn't exist yet.
     */
    getConfig(): Promise<AvailabilityConfig>;

    /**
     * Save the availability configuration.
     */
    save(config: AvailabilityConfig): Promise<void>;

    /**
     * Checks whether a specific time slot is available on a given date.
     */
    isSlotAvailable(date: Date, slot: string): Promise<boolean>;
}
