import { Component, inject, signal, computed, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import * as XLSX from 'xlsx';
import { StudentService } from '../services/student.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { NotificationService } from '../../../core/services/notification.service';
import { StudentImportRow, StudentImportResult, Gender } from '@shared/interfaces/student.interface';

/**
 * Bulk-import students from an Excel/CSV spreadsheet. The user downloads a
 * template with English column headers, fills it, uploads it; we parse it in
 * the browser, show a preview, let them pick the target branch (multi-branch
 * companies only), then POST all rows to the bulk-import endpoint.
 *
 * Canonical column headers (English, matched case/space/underscore-insensitively,
 * with a few common aliases): student_name (required), parent_name,
 * student_phone, parent_phone, gender, date_of_birth, email, address,
 * school_name, notes.
 */
type Field =
  | 'student_name' | 'parent_name' | 'student_phone' | 'parent_phone'
  | 'gender' | 'date_of_birth' | 'email' | 'address' | 'school_name' | 'notes';

// The canonical columns shown in the downloadable template, in order.
const TEMPLATE_COLUMNS: Field[] = [
  'student_name', 'parent_name', 'student_phone', 'parent_phone',
  'gender', 'date_of_birth', 'email', 'address', 'school_name', 'notes',
];

// Header alias → canonical field. Keys are normalized (lowercased, non-alnum
// stripped) so "Student Name", "student_name", "studentName" all match.
const HEADER_ALIASES: Record<string, Field> = {
  studentname: 'student_name', name: 'student_name', fullname: 'student_name',
  parentname: 'parent_name', guardianname: 'parent_name',
  studentphone: 'student_phone', phone: 'student_phone', mobile: 'student_phone', phonenumber: 'student_phone',
  parentphone: 'parent_phone', guardianphone: 'parent_phone',
  gender: 'gender', sex: 'gender',
  dateofbirth: 'date_of_birth', dob: 'date_of_birth', birthdate: 'date_of_birth', birthday: 'date_of_birth',
  email: 'email', studentemail: 'email',
  address: 'address',
  schoolname: 'school_name', school: 'school_name',
  notes: 'notes', note: 'notes',
};

const normalizeHeader = (h: any): string => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

@Component({
  selector: 'app-student-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, TableModule, SelectModule, TagModule, TranslateModule],
  templateUrl: './student-import-dialog.component.html',
})
export class StudentImportDialogComponent {
  private studentService = inject(StudentService);
  protected branchState = inject(BranchStateService);
  private notification = inject(NotificationService);
  private translate = inject(TranslateService);

  /** Two-way visibility, driven by the parent list page. */
  visible = model(false);
  /** Emitted after a successful import so the list can reload. */
  imported = output<void>();

  fileName = signal('');
  rows = signal<StudentImportRow[]>([]);
  skipped = signal(0);          // rows dropped for having no student name
  selectedBranchId = signal('');
  importing = signal(false);
  result = signal<StudentImportResult | null>(null);
  parseError = signal(false);

  templateColumns = TEMPLATE_COLUMNS;

  branchOptions = computed(() =>
    this.branchState.branches().map(b => ({ label: b.label, value: b.id })),
  );

  // The branch we'll import into: the single branch when there's only one,
  // otherwise whatever the user picked.
  effectiveBranchId = computed(() =>
    this.branchState.isSingleBranch() ? (this.branchState.onlyBranchId() ?? '') : this.selectedBranchId(),
  );

  canImport = computed(() =>
    !this.importing() && this.rows().length > 0 && !!this.effectiveBranchId() && !this.result(),
  );

  previewRows = computed(() => this.rows().slice(0, 50));

  onDialogShow() {
    this.reset();
  }

  private reset() {
    this.fileName.set('');
    this.rows.set([]);
    this.skipped.set(0);
    this.result.set(null);
    this.parseError.set(false);
    this.importing.set(false);
    this.selectedBranchId.set('');
  }

  close() {
    this.visible.set(false);
  }

  /** Build and download an .xlsx template with the canonical headers + an example row. */
  downloadTemplate() {
    const example: Record<Field, string> = {
      student_name: 'Ahmed Ali',
      parent_name: 'Mohamed Ali',
      student_phone: '01000000000',
      parent_phone: '01111111111',
      gender: 'MALE',
      date_of_birth: '2010-05-20',
      email: '',
      address: '',
      school_name: '',
      notes: '',
    };
    const aoa = [TEMPLATE_COLUMNS, TEMPLATE_COLUMNS.map(c => example[c])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'students-import-template.xlsx');
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.result.set(null);
    this.parseError.set(false);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
        this.parseMatrix(matrix);
      } catch {
        this.parseError.set(true);
        this.rows.set([]);
        this.skipped.set(0);
      }
    };
    reader.onerror = () => {
      this.parseError.set(true);
      this.rows.set([]);
    };
    reader.readAsArrayBuffer(file);
    // Allow re-selecting the same file (change won't fire otherwise).
    input.value = '';
  }

  private parseMatrix(matrix: any[][]) {
    // First non-empty row is the header row.
    const headerIdx = matrix.findIndex(r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== ''));
    if (headerIdx === -1) {
      this.parseError.set(true);
      this.rows.set([]);
      return;
    }

    const headers = matrix[headerIdx];
    // column index → canonical field
    const colMap = new Map<number, Field>();
    headers.forEach((h, i) => {
      const field = HEADER_ALIASES[normalizeHeader(h)];
      if (field) colMap.set(i, field);
    });

    if (![...colMap.values()].includes('student_name')) {
      this.parseError.set(true);
      this.rows.set([]);
      return;
    }

    const out: StudentImportRow[] = [];
    let skipped = 0;
    for (let r = headerIdx + 1; r < matrix.length; r++) {
      const cells = matrix[r];
      if (!Array.isArray(cells) || cells.every(c => String(c ?? '').trim() === '')) continue;

      const get = (f: Field): string => {
        for (const [idx, field] of colMap) {
          if (field === f) return String(cells[idx] ?? '').trim();
        }
        return '';
      };

      // The sheet always held one name; we used to chop it into first/last on
      // the way in. Students carry a single `name` now, so it goes straight in.
      const name = get('student_name');
      if (!name) { skipped++; continue; }

      out.push({
        name,
        parentName: get('parent_name') || null,
        phone: get('student_phone') || null,
        parentPhone: get('parent_phone') || null,
        gender: this.normalizeGender(get('gender')),
        dateOfBirth: this.toDateStr(this.rawCell(cells, colMap, 'date_of_birth')),
        email: get('email') || null,
        address: get('address') || null,
        schoolName: get('school_name') || null,
        notes: get('notes') || null,
      });
    }

    this.rows.set(out);
    this.skipped.set(skipped);
    this.parseError.set(out.length === 0);
  }

  private rawCell(cells: any[], colMap: Map<number, Field>, field: Field): any {
    for (const [idx, f] of colMap) if (f === field) return cells[idx];
    return '';
  }

  private normalizeGender(v: string): Gender | null {
    const s = v.toLowerCase().trim();
    if (['male', 'm', 'ذكر'].includes(s)) return 'MALE';
    if (['female', 'f', 'أنثى', 'انثى'].includes(s)) return 'FEMALE';
    return null;
  }

  /** Excel date cell (Date via cellDates), serial number, or string → YYYY-MM-DD. */
  private toDateStr(v: any): string | null {
    if (v === null || v === undefined || v === '') return null;
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (v instanceof Date && !isNaN(v.getTime())) return iso(v);
    if (typeof v === 'number' && isFinite(v)) {
      // Excel serial date → ms (25569 = days between 1899-12-30 and 1970-01-01).
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : iso(d);
    }
    const s = String(v).trim();
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : iso(d);
  }

  doImport() {
    const branchId = this.effectiveBranchId();
    if (!branchId || this.rows().length === 0) return;
    this.importing.set(true);
    this.studentService.bulkImportStudents(branchId, this.rows()).subscribe({
      next: (res) => {
        this.importing.set(false);
        this.result.set(res);
        if (res.created > 0) {
          this.notification.success(this.translate.instant('STUDENTS.IMPORT.SUCCESS', { count: res.created }));
          this.imported.emit();
        }
        if (res.created === 0 && res.failed > 0) {
          this.notification.warning(this.translate.instant('STUDENTS.IMPORT.ALL_FAILED'));
        }
      },
      error: () => {
        this.importing.set(false);
        // The HTTP interceptor already toasts a translated error.
      },
    });
  }
}
