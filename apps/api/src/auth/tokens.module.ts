import { Module } from '@nestjs/common';
import { TokenService } from './token.service';

/** Token signing/verification, shared by hospital auth, platform auth and the guard. */
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class TokensModule {}
