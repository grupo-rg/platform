export interface OtpService {
    /**
     * Generates a cryptographically secure random numeric code.
     */
    generateCode(length?: number): string;

    /**
     * Sends the OTP code to the lead's contact channel (usually email).
     */
    sendOtp(email: string, code: string): Promise<void>;
}

/**
 * Hash/compare del OTP. El dominio sólo ve hashes: el código en claro vive
 * únicamente en memoria durante la petición y en el email enviado.
 */
export interface OtpHasher {
    hash(leadId: string, code: string): string;
    matches(leadId: string, code: string, storedHash: string): boolean;
}
