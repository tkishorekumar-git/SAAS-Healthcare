import type { SmsProvider } from '../../src/auth/sms/sms.provider';

/** Records SMS instead of sending them, so tests can read codes and invitation links. */
export class CapturingSms implements SmsProvider {
  readonly sent: Array<{ phone: string; code: string }> = [];
  readonly invitations: Array<{ phone: string; hospitalName: string; link: string }> = [];

  async sendOneTimeCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }

  async sendInvitation(phone: string, hospitalName: string, link: string): Promise<void> {
    this.invitations.push({ phone, hospitalName, link });
  }

  lastCodeFor(phone: string): string {
    const message = [...this.sent].reverse().find((m) => m.phone === phone);
    if (!message) throw new Error(`no SMS code sent to ${phone}`);
    return message.code;
  }

  /** Hospital code and token from the latest invitation link sent to `phone`. */
  lastInvitationFor(phone: string): { hospitalCode: string; token: string } {
    const message = [...this.invitations].reverse().find((m) => m.phone === phone);
    if (!message) throw new Error(`no invitation sent to ${phone}`);
    const url = new URL(message.link);
    return {
      hospitalCode: url.searchParams.get('hospital')!,
      token: url.searchParams.get('token')!,
    };
  }
}
