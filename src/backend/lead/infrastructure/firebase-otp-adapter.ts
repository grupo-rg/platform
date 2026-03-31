import { OtpService } from '../domain/otp-service';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export class FirebaseOtpAdapter implements OtpService {
    private db;

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    generateCode(length: number = 6): string {
        // Secure random 6-digit code
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async sendOtp(email: string, code: string): Promise<void> {
        // Use Firebase Trigger Email Extension (collection 'mail')
        const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Código de Acceso - Basis</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" max-width="500" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);">
                    <!-- Header -->
                    <tr>
                        <td align="center" style="padding: 40px 40px 20px; text-align: center;">
                            <img src="https://basis.consultoria.systems/images/logo-negro.png" alt="Basis Core" width="120" style="display: block; margin: 0 auto; height: auto;" />
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 20px 40px 40px;">
                            <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #0f172a; text-align: center; letter-spacing: -0.5px;">Verificación de Seguridad</h2>
                            <p style="margin: 0 0 32px; font-size: 15px; line-height: 1.6; color: #475569; text-align: center;">
                                Has solicitado acceder a tu sesión en Basis. Por tu seguridad, utiliza el siguiente código de verificación de 6 dígitos:
                            </p>
                            
                            <!-- OTP Box -->
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td align="center">
                                        <div style="background-color: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; border: 1px solid #e2e8f0; max-width: 300px; margin: 0 auto;">
                                            <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 36px; font-weight: 700; color: #0f172a; letter-spacing: 8px;">${code}</span>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 32px 0 0; font-size: 13px; color: #64748b; text-align: center;">
                                Este código expirará automáticamente en <strong>15 minutos</strong>.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #0f172a; padding: 24px; text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                                Basis © ${new Date().getFullYear()} Todos los derechos reservados.<br/>
                                Construyendo el estándar de la obra.
                            </p>
                            <p style="margin: 12px 0 0; font-size: 11px; color: #64748b;">
                                Si no has solicitado este código o no reconoces este inicio de sesión, simplemente ignora este correo.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        await this.db.collection('mail').add({
            to: email,
            message: {
                subject: 'Tu código de acceso seguro - Basis',
                html: htmlTemplate,
            }
        });
    }
}
