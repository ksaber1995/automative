import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterLink, CardModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 p-4">
      <div class="w-full max-w-md">
        <p-card>
          <h2 class="text-2xl font-semibold text-center mb-4">Register</h2>
          <p class="text-center text-gray-600">Registration form will be implemented here</p>
          <div class="text-center mt-4">
            <a routerLink="/auth/login" class="text-primary-600 hover:text-primary-700">
              Back to Login
            </a>
          </div>
        </p-card>
      </div>
    </div>
  `
})
export class RegisterComponent {}
