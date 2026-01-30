import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { StudentService } from '../services/student.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Student } from '@shared/interfaces/student.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-student-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    ConfirmDialogModule,
    TooltipModule
  ],
  providers: [ConfirmationService],
  templateUrl: './student-list.component.html',
  styleUrl: './student-list.component.scss'
})
export class StudentListComponent implements OnInit {
  private studentService = inject(StudentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  students = signal<Student[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string | null = null;

  ngOnInit() {
    this.loadBranches();
    this.loadStudents();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      }
    });
  }

  loadStudents() {
    this.loading.set(true);
    if (this.selectedBranchId) {
      this.studentService.getStudentsByBranch(this.selectedBranchId).subscribe({
        next: (students) => {
          this.students.set(students);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    } else {
      this.studentService.getAllStudents().subscribe({
        next: (students) => {
          this.students.set(students);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    }
  }

  onBranchFilterChange() {
    this.loadStudents();
  }

  viewStudent(student: Student) {
    this.router.navigate(['/students', student.id]);
  }

  editStudent(student: Student) {
    this.router.navigate(['/students', student.id, 'edit']);
  }

  deleteStudent(student: Student) {
    this.confirmationService.confirm({
      message: `Are you sure you want to deactivate ${student.firstName} ${student.lastName}?`,
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.studentService.deleteStudent(student.id).subscribe({
          next: () => {
            this.notificationService.success('Student deactivated successfully');
            this.loadStudents();
          }
        });
      }
    });
  }

  createStudent() {
    this.router.navigate(['/students/create']);
  }

  getAge(dateOfBirth: string): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }
}
