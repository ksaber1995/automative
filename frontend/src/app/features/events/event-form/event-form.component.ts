import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EventService } from '../services/event.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-event-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TranslateModule,
  ],
  templateUrl: './event-form.component.html',
})
export class EventFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(EventService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  id: string | null = null;
  branches = signal<Branch[]>([]);

  private readonly typeValues = ['TRIP', 'COMPETITION', 'WORKSHOP', 'SEMINAR', 'CAMP', 'OTHER'] as const;
  private readonly statusValues = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

  typeOptions = signal<{ label: string; value: string }[]>([]);
  statusOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    this.rebuildOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildOptions());

    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      eventType: ['TRIP'],
      status: ['PLANNED'],
      branchId: [null],
      location: [''],
      startDate: [null],
      endDate: [null],
      description: [''],
    });
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({
      next: (rows) => {
        this.branches.set(rows);
        if (rows.length === 1 && !this.isEditMode()) {
          const ctrl = this.form.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(rows[0].id);
        }
      },
    });

    this.id = this.route.snapshot.paramMap.get('id');
    if (this.id) {
      this.isEditMode.set(true);
      this.load(this.id);
    }
  }

  load(id: string) {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: (row) => {
        this.form.patchValue({
          name: row.name,
          eventType: row.eventType,
          status: row.status,
          branchId: row.branchId,
          location: row.location || '',
          startDate: row.startDate ? new Date(row.startDate) : null,
          endDate: row.endDate ? new Date(row.endDate) : null,
          description: row.description || '',
        });
        this.loading.set(false);
      },
      error: () => {
        this.notifications.error('Failed to load event');
        this.loading.set(false);
        this.router.navigate(['/events']);
      },
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const payload: any = {
      name: v.name,
      eventType: v.eventType,
      status: v.status,
      branchId: v.branchId || undefined,
      location: v.location?.trim() || undefined,
      startDate: v.startDate ? this.toIsoDate(v.startDate) : undefined,
      endDate: v.endDate ? this.toIsoDate(v.endDate) : undefined,
      description: v.description?.trim() || undefined,
    };
    this.loading.set(true);
    if (this.isEditMode() && this.id) {
      this.service.update(this.id, payload).subscribe({
        next: () => {
          this.notifications.success('Event updated');
          this.router.navigate(['/events']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Update failed');
        },
      });
    } else {
      this.service.create(payload).subscribe({
        next: () => {
          this.notifications.success('Event created');
          this.router.navigate(['/events']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Create failed');
        },
      });
    }
  }

  cancel() { this.router.navigate(['/events']); }

  private rebuildOptions() {
    this.typeOptions.set(this.typeValues.map(v => ({
      label: this.translate.instant('EVENTS.TYPE.' + v), value: v,
    })));
    this.statusOptions.set(this.statusValues.map(v => ({
      label: this.translate.instant('EVENTS.STATUS.' + v), value: v,
    })));
  }

  private toIsoDate(d: any): string {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return d;
  }
}
