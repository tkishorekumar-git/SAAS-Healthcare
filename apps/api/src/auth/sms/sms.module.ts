import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { DevelopmentSmsProvider, SMS_PROVIDER } from './sms.provider';

/** One SMS provider instance shared by login codes, invitations and onboarding. */
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        switch (config.get('SMS_PROVIDER', { infer: true })) {
          case 'development':
            return new DevelopmentSmsProvider(config.get('NODE_ENV', { infer: true }));
        }
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
