import { UserRole } from '../enums/user-role.enum';
export interface User {
    id: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    branchId?: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface SafeUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    branchId?: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface UserCreateDto {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    branchId?: string | null;
}
export interface UserUpdateDto {
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: UserRole;
    branchId?: string | null;
    isActive?: boolean;
}
export interface LoginDto {
    email: string;
    password: string;
}
export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    user: SafeUser;
}
