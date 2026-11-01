import type { TenantTransaction } from '@kenisha/database';
import type { TenantId } from '@kenisha/shared';
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

/** Web: HttpOnly cookie on the /auth path. Mobile: `deviceToken` in the request body. */
export const DEVICE_COOKIE = 'kenisha_dev';
/** Browsers cap cookie lifetimes at 400 days. */
export const DEVICE_COOKIE_MAX_AGE_MS = 400 * 86_400_000;

const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface DeviceCheck {
  /** The token the client should keep (the presented one, or a new one). */
  token: string;
  /** No known device of this user matched. */
  isNew: boolean;
  /** The user had no known devices at all (first sign-in after accepting an invitation). */
  isFirstDevice: boolean;
}

/**
 * Recognises devices a staff member has signed in from before (ADR-0005), so a sign-in
 * from a new device can be reported to the account owner. The device token is 256 random
 * bits; only its SHA-256 hash is stored, like refresh tokens.
 */
@Injectable()
export class KnownDeviceService {
  async recognise(
    tx: TenantTransaction,
    tenantId: TenantId,
    userId: string,
    presented: string | undefined,
    now: Date,
  ): Promise<DeviceCheck> {
    if (presented && DEVICE_TOKEN.test(presented)) {
      const known = await tx.knownDevice.findUnique({
        where: { tenantId_userId_deviceHash: { tenantId, userId, deviceHash: hash(presented) } },
        select: { id: true },
      });
      if (known) {
        await tx.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: now } });
        return { token: presented, isNew: false, isFirstDevice: false };
      }
    }

    const isFirstDevice = (await tx.knownDevice.count({ where: { userId } })) === 0;
    const token = randomBytes(32).toString('base64url');
    await tx.knownDevice.create({
      data: { tenantId, userId, deviceHash: hash(token), firstSeenAt: now, lastSeenAt: now },
    });
    return { token, isNew: true, isFirstDevice };
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
