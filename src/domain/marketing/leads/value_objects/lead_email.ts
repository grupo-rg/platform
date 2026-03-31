export class LeadEmail {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  public get value(): string {
    return this._value;
  }

  public static create(email: string): LeadEmail {
    if (!email || email.trim() === '') {
      throw new Error('Email cannot be empty');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    return new LeadEmail(email.toLowerCase().trim());
  }

  public equals(other: LeadEmail): boolean {
    return this._value === other.value;
  }
}
