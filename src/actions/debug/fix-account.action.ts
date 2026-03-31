'use server';

import { adminAuth } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { Lead, PersonalInfo, LeadPreferences, LeadVerification } from '@/backend/lead/domain/lead';

const leadRepository = new FirestoreLeadRepository();

/**
 * Ensures a Lead profile exists for a given User ID.
 * If not, it fetches the user from Firebase Auth and creates a basic Lead profile.
 * This is useful for Admins who log in directly without going through the Lead Capture flow.
 */
export async function ensureLeadProfile(userId: string) {
    // 1. Check if lead exists
    try {
        const existingLead = await leadRepository.findById(userId);
        if (existingLead) return { success: true, message: "Lead profile already exists." };

        console.log(`[FixAccount] Creating Lead profile for user ${userId}...`);

        // 2. Fetch User from Auth
        const userRecord = await adminAuth.getUser(userId);
        const email = userRecord.email;

        if (!email) throw new Error("User has no email in Auth.");

        // 3. Create Lead Profile
        const newLead = new Lead(
            userId,
            {
                name: userRecord.displayName || 'Admin User',
                email: email,
                phone: userRecord.phoneNumber || ''
            } as PersonalInfo,
            {
                contactMethod: 'email',
                language: 'es'
            } as LeadPreferences,
            {
                isVerified: true, // Auto-verify since they are authenticated
                verifiedAt: new Date(),
                attempts: 0,
                otpCode: undefined,
                otpExpiresAt: undefined
            } as LeadVerification,
            null, // <--- Added null for `profile`
            new Date(),
            new Date()
        );

        await leadRepository.save(newLead);
        console.log(`[FixAccount] Lead profile created for ${email}`);
        return { success: true, message: "Lead profile created for Admin." };

    } catch (error: any) {
        console.error("Error ensuring lead profile:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Sets the 'admin' custom claim for a user by email.
 * This grants them access to the Admin Dashboard.
 */
export async function setAdminClaim(email: string, secret: string) {
    const ADMIN_SECRET = process.env.ADMIN_SECRET || "dochevi-admin-dev-secret"; // Fallback only for dev

    if (secret !== ADMIN_SECRET) {
        console.warn(`[FixAccount] Unauthorized attempt to set admin claim for ${email}`);
        return { success: false, error: "Unauthorized: Invalid Secret" };
    }

    try {
        console.log(`[FixAccount] Setting admin claim for ${email}...`);
        const user = await adminAuth.getUserByEmail(email);
        await adminAuth.setCustomUserClaims(user.uid, { admin: true });
        console.log(`[FixAccount] Admin claim set for ${email} (uid: ${user.uid})`);
        return { success: true, message: `Admin claim set for ${email}` };
    } catch (error: any) {
        console.error("Error setting admin claim:", error);
        return { success: false, error: error.message };
    }
}
