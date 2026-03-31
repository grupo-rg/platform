export interface ExperimentEventProps {
    id: string;
    experimentId: string;
    variantId: string;
    visitorId: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export class ExperimentEvent {
    private _props: ExperimentEventProps;

    private constructor(props: ExperimentEventProps) {
        this._props = props;
    }

    public get id(): string { return this._props.id; }
    public get experimentId(): string { return this._props.experimentId; }
    public get variantId(): string { return this._props.variantId; }
    public get visitorId(): string { return this._props.visitorId; }
    public get timestamp(): Date { return this._props.timestamp; }
    public get metadata(): Record<string, any> | undefined { return this._props.metadata; }

    public static create(props: Omit<ExperimentEventProps, 'timestamp'> & { timestamp?: Date }): ExperimentEvent {
        if (!props.experimentId || !props.variantId || !props.visitorId) {
            throw new Error('Missing required fields for ExperimentEvent');
        }
        return new ExperimentEvent({
            ...props,
            timestamp: props.timestamp ?? new Date(),
        });
    }
}
