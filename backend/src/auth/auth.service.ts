import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private dataStore: DataStoreService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const users = await this.dataStore.findBy(
      FILE_PATHS.USERS,
      DATA_KEYS.USERS,
      (user: any) => user.email === email,
    );

    if (users.length === 0) {
      return null;
    }

    const user = users[0];

    if (!user.isActive) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user,
    };
  }

  async register(registerDto: RegisterDto) {
    // Check if user already exists
    const existingUsers = await this.dataStore.findBy(
      FILE_PATHS.USERS,
      DATA_KEYS.USERS,
      (user: any) => user.email === registerDto.email,
    );

    if (existingUsers.length > 0) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const newUser = await this.dataStore.create(FILE_PATHS.USERS, DATA_KEYS.USERS, {
      email: registerDto.email,
      password: hashedPassword,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      role: registerDto.role,
      branchId: registerDto.branchId || null,
      isActive: true,
    });

    const { password: _, ...userWithoutPassword } = newUser as any;

    const tokens = await this.generateTokens(userWithoutPassword);

    return {
      ...tokens,
      user: userWithoutPassword,
    };
  }

  async getProfile(userId: string) {
    const user = await this.dataStore.findById(
      FILE_PATHS.USERS,
      DATA_KEYS.USERS,
      userId,
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { password: _, ...userWithoutPassword } = user as any;
    return userWithoutPassword;
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.dataStore.findById(
        FILE_PATHS.USERS,
        DATA_KEYS.USERS,
        payload.sub,
      );

      if (!user || !(user as any).isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const { password: _, ...userWithoutPassword } = user as any;
      return this.generateTokens(userWithoutPassword);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async generateTokens(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRATION'),
      }),
      this.jwtService.signAsync(
        { sub: user.id },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION'),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.dataStore.findById(
      FILE_PATHS.USERS,
      DATA_KEYS.USERS,
      userId,
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      (user as any).password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.dataStore.update(FILE_PATHS.USERS, DATA_KEYS.USERS, userId, {
      password: hashedPassword,
    } as any);

    return { message: 'Password changed successfully' };
  }
}
