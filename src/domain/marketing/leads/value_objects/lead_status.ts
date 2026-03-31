export type LeadStatusValue = 'NEW' | 'CONTACTED' | 'DEMO_BOOKED' | 'DISQUALIFIED';

export class LeadStatus {
    private readonly _value: LeadStatusValue;

    private constructor(value: LeadStatusValue) {
        this._value = value;
    }

    public get value(): LeadStatusValue {
        return this._value;
    }

    public static create(status: LeadStatusValue = 'NEW'): LeadStatus {
        return new LeadStatus(status);
    }

    public equals(other: LeadStatus): boolean {
        return this._value === other.value;
    }
}
