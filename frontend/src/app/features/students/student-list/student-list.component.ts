import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-student-list',
  standalone: true,
  imports: [CommonModule, CardModule],
  template: `<div class="container-custom py-8"><h1 class="text-3xl font-bold mb-6">Students</h1><p-card><p>Student management will be implemented here</p></p-card></div>`
})
export class StudentListComponent {}
