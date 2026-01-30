import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthResponse, SafeUser } from '../../../shared/interfaces/user.interface';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(loginDto);
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(registerDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req): Promise<SafeUser> {
    return this.authService.getProfile(req.user.id);
  }

  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Request() req,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
  ) {
    return this.authService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout() {
    // With JWT, logout is handled on the client side by removing the token
    return { message: 'Logout successful' };
  }
}
