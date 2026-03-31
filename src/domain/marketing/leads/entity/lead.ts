import { LeadEmail } from '../value_objects/lead_email';
import { LeadStatus } from '../value_objects/lead_status';

export interface LeadProps {
    id: string;
    email: LeadEmail;
    source: string;
    companyProfile?: Record<string, string>;
    pdfMetadata?: Record<string, string>;
    status: LeadStatus;
    createdAt: Date;
    updatedAt: Date;
}

export class Lead {
    private _props: LeadProps;

    private constructor(props: LeadProps) {
        this._props = props;
    }

    public get id(): string { return this._props.id; }
    public get email(): LeadEmail { return this._props.email; }
    public get source(): string { return this._props.source; }
    public get companyProfile(): Record<string, string> | undefined { return this._props.companyProfile; }
    public get pdfMetadata(): Record<string, string> | undefined { return this._props.pdfMetadata; }
    public get status(): LeadStatus { return this._props.status; }
    public get createdAt(): Date { return this._props.createdAt; }
    public get updatedAt(): Date { return this._props.updatedAt; }

    public static create(props: Omit<LeadProps, 'status' | 'createdAt' | 'updatedAt'> & { status?: LeadStatus, createdAt?: Date }): Lead {
        return new Lead({
            ...props,
            status: props.status ?? LeadStatus.create('NEW'),
            createdAt: props.createdAt ?? new Date(),
            updatedAt: props.createdAt ?? new Date(),
        });
    }

    public updateStatus(newStatus: LeadStatus): void {
        this._props.status = newStatus;
        this._props.updatedAt = new Date();
    }

    public addCompanyProfile(profile: Record<string, string>): void {
        this._props.companyProfile = { ...this._props.companyProfile, ...profile };
        this._props.updatedAt = new Date();
    }

    public updatePdfMetadata(metadata: Record<string, string>): void {
        this._props.pdfMetadata = metadata;
        this._props.updatedAt = new Date();
    }
}
