import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DataStoreService } from '../../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../../data-store/file-paths.constant';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  branchId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private dataStore: DataStoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.dataStore.findById(
      FILE_PATHS.USERS,
      DATA_KEYS.USERS,
      payload.sub,
    );

    if (!user || !(user as any).isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Remove password from user object
    const { password, ...userWithoutPassword } = user as any;

    return userWithoutPassword;
  }
}
