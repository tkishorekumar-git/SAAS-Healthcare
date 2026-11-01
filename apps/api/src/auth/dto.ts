import type {
  AuthClient,
  CurrentUser,
  HealthcareModuleKey,
  Permission,
  UserRole,
} from '@kenisha/shared';
import { HEALTHCARE_MODULE_KEYS, PERMISSIONS, USER_ROLES } from '@kenisha/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const HOSPITAL_CODE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const CLIENTS: AuthClient[] = ['web', 'mobile'];

class HospitalScopedDto {
  @ApiProperty({ example: 'demo-aarogya', description: 'Hospital login code' })
  @IsString()
  @Matches(HOSPITAL_CODE, { message: 'hospitalCode is not a valid hospital code' })
  hospitalCode!: string;
}

class CodeVerificationDto extends HospitalScopedDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  @ApiProperty({ enum: CLIENTS })
  @IsIn(CLIENTS)
  client!: AuthClient;
}

export class RequestCodeDto extends HospitalScopedDto {
  @ApiProperty({ example: '+919876543210', description: 'Mobile number in E.164 format' })
  @IsString()
  @MaxLength(24)
  phone!: string;
}

export class VerifyCodeDto extends CodeVerificationDto {}

export class StaffLoginDto extends HospitalScopedDto {
  @ApiProperty({ example: 'doctor@example.test', description: 'Email or E.164 mobile number' })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ enum: CLIENTS })
  @IsIn(CLIENTS)
  client!: AuthClient;

  @ApiPropertyOptional({
    description: 'Mobile only: the device token from an earlier sign-in. Web uses a cookie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceToken?: string;
}

export class StaffCodeDto extends CodeVerificationDto {
  @ApiPropertyOptional({
    description: 'Mobile only: the device token from an earlier sign-in. Web uses a cookie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceToken?: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mobile only. Web sends the HttpOnly cookie instead.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

export class ChallengeResponseDto {
  @ApiProperty({ format: 'uuid' })
  challengeId!: string;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;
}

export class TokensResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiPropertyOptional({ description: 'Mobile clients only' })
  refreshToken?: string;

  @ApiPropertyOptional({ description: 'Mobile staff sign-in only: keep and send next time' })
  deviceToken?: string;
}

export class StaffLoginResponseDto {
  @ApiProperty({ enum: ['MFA_REQUIRED', 'AUTHENTICATED'] })
  status!: 'MFA_REQUIRED' | 'AUTHENTICATED';

  @ApiPropertyOptional({ format: 'uuid' })
  challengeId?: string;

  @ApiPropertyOptional()
  expiresInSeconds?: number;

  @ApiPropertyOptional({ type: TokensResponseDto })
  tokens?: TokensResponseDto;
}

export class CurrentUserDto implements CurrentUser {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ['STAFF', 'PERSONAL'] })
  accountKind!: 'STAFF' | 'PERSONAL';

  @ApiProperty({ enum: USER_ROLES, isArray: true })
  roles!: UserRole[];

  @ApiProperty({ enum: PERMISSIONS, isArray: true })
  permissions!: Permission[];

  @ApiProperty({ enum: HEALTHCARE_MODULE_KEYS, isArray: true })
  enabledModules!: HealthcareModuleKey[];
}
