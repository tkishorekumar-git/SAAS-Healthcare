import { Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Sends SMS. Production implementations (MSG91, Twilio, ...) need DLT-registered templates. */
export interface SmsProvider {
  sendOneTimeCode(phoneE164: string, code: string): Promise<void>;
  /** Staff invitation: a one-time link to activate the account (ADR-0004 section 1). */
  sendInvitation(phoneE164: string, hospitalName: string, link: string): Promise<void>;
  /** "Your account was signed in to from a new device" (ADR-0005). */
  sendNewDeviceAlert(phoneE164: string, hospitalName: string): Promise<void>;
}

/**
 * Writes messages to the API log instead of sending SMS. Refuses to exist outside
 * development, test and the staging deployment (synthetic data only, ADR-0006), so a
 * misconfigured production server fails at startup.
 */
export class DevelopmentSmsProvider implements SmsProvider {
  private readonly logger = new Logger('DevelopmentSms');

  constructor(nodeEnv: string, deploymentEnv: string = 'local') {
    const allowed =
      deploymentEnv === 'staging' ||
      (deploymentEnv === 'local' && (nodeEnv === 'development' || nodeEnv === 'test'));
    if (!allowed) {
      throw new Error(
        'SMS_PROVIDER=development is only allowed locally (development/test) or on staging',
      );
    }
  }

  async sendOneTimeCode(phoneE164: string, code: string): Promise<void> {
    // Only the last 4 digits of the number - full numbers are personal data.
    this.logger.warn(`[DEV ONLY] code for ******${phoneE164.slice(-4)}: ${code}`);
  }

  async sendInvitation(phoneE164: string, hospitalName: string, link: string): Promise<void> {
    this.logger.warn(
      `[DEV ONLY] invitation to ${hospitalName} for ******${phoneE164.slice(-4)}: ${link}`,
    );
  }

  async sendNewDeviceAlert(phoneE164: string, hospitalName: string): Promise<void> {
    this.logger.warn(
      `[DEV ONLY] new-device sign-in alert (${hospitalName}) for ******${phoneE164.slice(-4)}`,
    );
  }
}
