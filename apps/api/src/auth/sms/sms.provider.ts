import { Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Sends one-time codes. Production implementations (MSG91, Twilio, …) need DLT templates. */
export interface SmsProvider {
  sendOneTimeCode(phoneE164: string, code: string): Promise<void>;
}

/**
 * Writes codes to the API log instead of sending SMS. Refuses to exist outside
 * development and test, so a misconfigured production server fails at startup.
 */
export class DevelopmentSmsProvider implements SmsProvider {
  private readonly logger = new Logger('DevelopmentSms');

  constructor(nodeEnv: string) {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error(
        'SMS_PROVIDER=development is only allowed when NODE_ENV is development or test',
      );
    }
  }

  async sendOneTimeCode(phoneE164: string, code: string): Promise<void> {
    // Only the last 4 digits of the number — full numbers are personal data.
    this.logger.warn(`[DEV ONLY] code for ******${phoneE164.slice(-4)}: ${code}`);
  }
}
