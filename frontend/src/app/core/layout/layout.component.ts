import { Component, signal, OnInit, OnDestroy, HostListener, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { Html5Qrcode } from 'html5-qrcode';
import { BreadcrumbsComponent } from '../../shared/components/breadcrumbs/breadcrumbs.component';
import { AuthService } from '../services/auth.service';
import { SubscriptionService } from '../services/subscription.service';
import { LanguageService } from '../services/language.service';
import { NotificationService } from '../services/notification.service';
import { StudentService } from '../../features/students/services/student.service';
import { GlobalScanService } from '../services/global-scan.service';
import { ScanPreferenceService } from '../services/scan-preference.service';
import { UserRole, ROLE_LABELS } from '@shared/enums/user-role.enum';

interface NavLeaf {
  labelKey: string;
  icon: string;
  routerLink: string[];
  visible: boolean;
}

interface NavGroup {
  groupKey: string;
  labelKey: string;
  icon: string;
  children: NavLeaf[];
}

type NavEntry =
  | { kind: 'leaf'; leaf: NavLeaf }
  | { kind: 'group'; group: NavGroup };

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    AvatarModule,
    MenuModule,
    DialogModule,
    TooltipModule,
    TranslateModule,
    BreadcrumbsComponent,
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'})
export class LayoutComponent implements OnInit, OnDestroy {
  sidebarVisible = signal(true);
  currentUser = this.authService.currentUser;
  subscriptionService = inject(SubscriptionService);
  languageService = inject(LanguageService);
  private translate = inject(TranslateService);
  private notifications = inject(NotificationService);
  private studentService = inject(StudentService);
  private globalScan = inject(GlobalScanService);
  private scanPref = inject(ScanPreferenceService);

  // QR Scanner
  qrDialogVisible = signal(false);
  qrScanning = signal(false);
  qrLookingUp = signal(false);
  cameraStarted = signal(false);
  // Expose the per-device USB-scanner flag to the template.
  usbDetected = () => this.scanPref.usbDetected();
  private html5Qr?: Html5Qrcode;
  private readonly QR_SCANNER_ID = 'navbar-qr-scanner-region';

  // ── Always-on USB scanner (keyboard-wedge) ────────────────────────────────
  // A handheld scanner "types" the token as a fast keystroke burst ending with
  // Enter; we capture it app-wide (no field focus, no button) and dispatch it.
  // The camera button above remains a deliberate, click-to-open "find student".
  private scanBuffer = '';
  private scanBufferAt = 0;
  // A gap longer than this between keystrokes is a human typing, not a scanner.
  private readonly SCAN_KEY_GAP_MS = 100;

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const now = Date.now();
    if (now - this.scanBufferAt > this.SCAN_KEY_GAP_MS) this.scanBuffer = '';
    this.scanBufferAt = now;

    if (e.key === 'Enter') {
      const buf = this.scanBuffer;
      this.scanBuffer = '';
      if (buf) {
        e.preventDefault();
        // A no-focus keystroke burst ending in Enter is a USB scanner — remember
        // it so the scan button stops defaulting to the camera on this device.
        this.scanPref.markUsbDetected();
        // If the navbar QR-search dialog is open, this is a deliberate "find
        // student" scan: force-open their detail page and close the dialog.
        // Otherwise fall back to the silent attendance-taking dispatch.
        const explicit = this.qrDialogVisible();
        this.globalScan.dispatch(buf, explicit);
        if (explicit) this.closeQrScanner();
      }
      return;
    }
    // Capture from the PHYSICAL key (e.code), not e.key: a USB keyboard-wedge
    // scanner emits US-layout scancodes, but e.key is translated through the
    // OS's active layout. With a non-Latin layout active (e.g. Arabic), e.key
    // would turn the scanned URL into garbage — the '/p/s/' marker then fails
    // to match and the whole mangled string is sent as the token (→ "must
    // contain at most 64 characters"). Reconstructing from e.code keeps scans
    // working regardless of the active keyboard layout.
    const ch = this.scanCharForCode(e);
    if (ch) this.scanBuffer += ch;
    else if (e.key.length === 1) this.scanBuffer += e.key; // fallback (e.g. dead keys)
  }

  /** Map a KeyboardEvent's physical key (e.code) to its US-layout character. */
  private scanCharForCode(e: KeyboardEvent): string | null {
    const code = e.code;
    if (code.startsWith('Key') && code.length === 4) {
      const c = code.charAt(3).toLowerCase();
      return e.shiftKey ? c.toUpperCase() : c;
    }
    if (code.startsWith('Digit') && code.length === 6) {
      const d = code.charAt(5);
      return e.shiftKey ? ')!@#$%^&*('.charAt(Number(d)) : d;
    }
    if (code.startsWith('Numpad')) {
      const n = code.slice(6);
      if (/^\d$/.test(n)) return n;
      const numpad: Record<string, string> = {
        Divide: '/', Multiply: '*', Subtract: '-', Add: '+', Decimal: '.',
      };
      return numpad[n] ?? null;
    }
    const punct: Record<string, [string, string]> = {
      Slash: ['/', '?'], Period: ['.', '>'], Comma: [',', '<'],
      Minus: ['-', '_'], Equal: ['=', '+'], Semicolon: [';', ':'],
      Quote: ["'", '"'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
      Backslash: ['\\', '|'], Backquote: ['`', '~'],
    };
    const p = punct[code];
    return p ? (e.shiftKey ? p[1] : p[0]) : null;
  }

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    this.subscriptionService.load().subscribe({ error: () => {} });
    this.syncOpenGroupFromUrl(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.syncOpenGroupFromUrl(e.urlAfterRedirects || e.url));
  }

  // ─── Computed menu (permission-aware, grouped) ──────────────────────────

  openGroups = signal<Set<string>>(new Set<string>());

  visibleMenuEntries = computed<NavEntry[]>(() => {
    const auth = this.authService;
    const entries: NavEntry[] = [];

    // Dashboard (standalone)
    if (auth.canRead('dashboard')) {
      entries.push({ kind: 'leaf', leaf: {
        labelKey: 'NAV.DASHBOARD', icon: 'pi pi-home', routerLink: ['/dashboard'], visible: true,
      }});
    }

    // Academic
    const academic: NavLeaf[] = [
      { labelKey: 'NAV.COURSES', icon: 'pi pi-book', routerLink: ['/courses'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.MASTER_COURSES', icon: 'pi pi-th-large', routerLink: ['/master-courses'], visible: auth.canRead('academy') && !auth.isTeacher() },
      { labelKey: 'NAV.CLASSES', icon: 'pi pi-calendar', routerLink: ['/classes'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.ROOMS', icon: 'pi pi-building', routerLink: ['/rooms'], visible: auth.canRead('academy') && !auth.isTeacher() },
      // Session history is the Sessions page's History tab now; the route stays
      // reachable by URL, it just doesn't need its own sidebar entry.
      { labelKey: 'NAV.SESSIONS', icon: 'pi pi-clock', routerLink: ['/sessions'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.TIMETABLE', icon: 'pi pi-calendar-clock', routerLink: ['/timetable'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.EVENTS', icon: 'pi pi-flag', routerLink: ['/events'], visible: auth.canRead('academy') && !auth.isTeacher() },
      { labelKey: 'NAV.EXAMS', icon: 'pi pi-file-edit', routerLink: ['/exams'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.EDUCATIONAL_BOOKS', icon: 'pi pi-book', routerLink: ['/educational-books'], visible: auth.canRead('product_sales') },
    ].filter(c => c.visible);
    if (academic.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'academic', labelKey: 'NAV.GROUPS.ACADEMIC', icon: 'pi pi-graduation-cap', children: academic,
      }});
    }

    // People
    const people: NavLeaf[] = [
      { labelKey: 'NAV.STUDENTS', icon: 'pi pi-users', routerLink: ['/students'], visible: auth.canRead('students') },
      { labelKey: 'NAV.EMPLOYEES', icon: 'pi pi-user', routerLink: ['/employees'], visible: auth.canRead('employees') },
      { labelKey: 'NAV.ATTENDANCE_TEACHERS', icon: 'pi pi-user-edit', routerLink: ['/attendance/teachers'], visible: auth.canRead('academy') && !auth.isTeacher() },
    ].filter(c => c.visible);
    if (people.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'people', labelKey: 'NAV.GROUPS.PEOPLE', icon: 'pi pi-users', children: people,
      }});
    }

    // Client Management (CRM) — its own top-level group; each tab is a route.
    const clientMgmt: NavLeaf[] = [
      { labelKey: 'NAV.CRM_LEADS', icon: 'pi pi-filter', routerLink: ['/crm'], visible: auth.canUseCrm() },
      { labelKey: 'NAV.CRM_LISTS', icon: 'pi pi-bookmark', routerLink: ['/crm/lists'], visible: auth.canUseCrm() },
      { labelKey: 'NAV.CRM_TASKS', icon: 'pi pi-check-square', routerLink: ['/crm/tasks'], visible: auth.canUseCrm() },
      { labelKey: 'NAV.CRM_INSIGHTS', icon: 'pi pi-chart-bar', routerLink: ['/crm/insights'], visible: auth.canUseCrm() },
      { labelKey: 'NAV.CRM_RETENTION', icon: 'pi pi-heart', routerLink: ['/crm/retention'], visible: auth.canUseCrm() },
    ].filter(c => c.visible);
    if (clientMgmt.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'clientMgmt', labelKey: 'NAV.GROUPS.CLIENT_MGMT', icon: 'pi pi-address-book', children: clientMgmt,
      }});
    }

    // WhatsApp (Cloud API) — company messaging config + inbox.
    // Shown to the tenants trialling it while the Meta setup is worked through
    // per company (see AuthService.canUseWhatsapp).
    // Routes/pages stay reachable by URL; only the nav group is hidden.
    const whatsappEnabled = auth.canUseWhatsapp();
    const whatsapp: NavLeaf[] = [
      { labelKey: 'NAV.WA_CONNECT', icon: 'pi pi-link', routerLink: ['/whatsapp/connect'], visible: whatsappEnabled && auth.canRead('academy') },
      { labelKey: 'NAV.WA_INBOX', icon: 'pi pi-inbox', routerLink: ['/whatsapp/inbox'], visible: whatsappEnabled && auth.canRead('academy') },
      { labelKey: 'NAV.WA_SETTINGS', icon: 'pi pi-cog', routerLink: ['/whatsapp/settings'], visible: whatsappEnabled && auth.canWrite('academy') },
      { labelKey: 'NAV.WA_TEMPLATES', icon: 'pi pi-file-edit', routerLink: ['/whatsapp/templates'], visible: whatsappEnabled && auth.canWrite('academy') },
    ].filter(c => c.visible);
    if (whatsapp.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'whatsapp', labelKey: 'NAV.GROUPS.WHATSAPP', icon: 'pi pi-whatsapp', children: whatsapp,
      }});
    }

    // Financial
    const financial: NavLeaf[] = [
      // The daily collection screens — what students owe and pay — so they lead the
      // group rather than sitting under the ledgers.
      { labelKey: 'NAV.MONTHLY_SUBSCRIPTIONS', icon: 'pi pi-calendar', routerLink: ['/monthly-subscriptions'], visible: auth.canRead('academy') },
      { labelKey: 'NAV.SESSION_PAYMENTS', icon: 'pi pi-wallet', routerLink: ['/session-payments'], visible: auth.canRead('enrollments') },
      { labelKey: 'NAV.CASH', icon: 'pi pi-wallet', routerLink: ['/cash'], visible: auth.canRead('cash') && !auth.isTeacher() },
      { labelKey: 'NAV.REVENUES', icon: 'pi pi-dollar', routerLink: ['/revenues'], visible: auth.canRead('revenues') },
      { labelKey: 'NAV.EXPENSES', icon: 'pi pi-money-bill', routerLink: ['/expenses'], visible: auth.canRead('expenses') },
      { labelKey: 'NAV.REFUNDS', icon: 'pi pi-replay', routerLink: ['/refunds'], visible: auth.canRead('refunds') },
      { labelKey: 'NAV.DUES', icon: 'pi pi-credit-card', routerLink: ['/dues'], visible: auth.canRead('enrollments') },
    ].filter(c => c.visible);
    if (financial.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'financial', labelKey: 'NAV.GROUPS.FINANCIAL', icon: 'pi pi-money-bill', children: financial,
      }});
    }

    // Inventory
    const inventory: NavLeaf[] = [
      { labelKey: 'NAV.PRODUCTS', icon: 'pi pi-box', routerLink: ['/products/list'], visible: auth.canRead('products') },
      { labelKey: 'NAV.SELL_PRODUCT', icon: 'pi pi-shopping-cart', routerLink: ['/products/sell'], visible: auth.canWrite('product_sales') },
      { labelKey: 'NAV.SALES_HISTORY', icon: 'pi pi-history', routerLink: ['/products/sales'], visible: auth.canRead('product_sales') },
    ].filter(c => c.visible);
    if (inventory.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'inventory', labelKey: 'NAV.GROUPS.INVENTORY', icon: 'pi pi-box', children: inventory,
      }});
    }

    // Reports (standalone)
    if (auth.canRead('reports')) {
      entries.push({ kind: 'leaf', leaf: {
        labelKey: 'NAV.REPORTS', icon: 'pi pi-chart-bar', routerLink: ['/reports'], visible: true,
      }});
    }

    // Admin — only Global Admins see this section at all.
    const admin: NavLeaf[] = auth.isGlobalAdmin() ? [
      { labelKey: 'NAV.USERS', icon: 'pi pi-user-edit', routerLink: ['/users'], visible: auth.canRead('users') },
      { labelKey: 'NAV.MESSAGING', icon: 'pi pi-comments', routerLink: ['/messaging'], visible: true },
      { labelKey: 'NAV.SETTINGS', icon: 'pi pi-cog', routerLink: ['/settings'], visible: true },
      // Set-up-once configuration rather than daily screens, so they live here with
      // Settings instead of cluttering Academic and People. Levels carries no
      // permission check of its own — the Admin group is already global-admin gated.
      { labelKey: 'NAV.BRANCHES', icon: 'pi pi-building', routerLink: ['/branches'], visible: auth.canRead('academy') && !auth.isTeacher() },
      { labelKey: 'NAV.LEVELS', icon: 'pi pi-sort-amount-up', routerLink: ['/levels'], visible: true },
      // Shared back face of the printed ID cards — a company-wide setting, and
      // isGlobalAdmin() (which gates this whole group) is exactly who the API lets
      // save it, so it sits with Settings rather than with the students.
      { labelKey: 'NAV.CARD_DESIGN', icon: 'pi pi-id-card', routerLink: ['/card-design'], visible: auth.canRead('students') },
      // The pool of pre-printed blank QR cards, and which student each one is on.
      { labelKey: 'NAV.QR_CARDS', icon: 'pi pi-qrcode', routerLink: ['/qr-cards'], visible: auth.canRead('students') && auth.canUseQrCards() },
    ].filter(c => c.visible) : [];
    if (admin.length) {
      entries.push({ kind: 'group', group: {
        groupKey: 'admin', labelKey: 'NAV.GROUPS.ADMIN', icon: 'pi pi-shield', children: admin,
      }});
    }

    return entries;
  });

  toggleGroup(key: string) {
    this.openGroups.update(s => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  isGroupOpen(key: string): boolean {
    return this.openGroups().has(key);
  }

  entryTrackBy(index: number, entry: NavEntry): string {
    return entry.kind === 'leaf' ? 'L:' + entry.leaf.routerLink[0] : 'G:' + entry.group.groupKey;
  }

  /** Auto-open the group that contains the current URL so the active item is visible. */
  private syncOpenGroupFromUrl(url: string) {
    const groups = this.visibleMenuEntries().filter(e => e.kind === 'group');
    for (const e of groups) {
      if (e.kind !== 'group') continue;
      const match = e.group.children.some(c => url === c.routerLink[0] || url.startsWith(c.routerLink[0] + '/'));
      if (match) {
        this.openGroups.update(s => {
          if (s.has(e.group.groupKey)) return s;
          const next = new Set(s);
          next.add(e.group.groupKey);
          return next;
        });
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  toggleSidebar() { this.sidebarVisible.update(v => !v); }

  getUserInitials(user: any): string {
    return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  }

  getCompanyName(_user: any): string {
    return localStorage.getItem('company_name') || this.translate.instant('COMPANY_PROFILE.DEFAULT_NAME');
  }

  getAvatarColor(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: '#7C3AED', ADMIN: '#7C3AED',
      BRANCH_ADMIN: '#2563EB', BRANCH_MANAGER: '#2563EB',
      ACADEMIC_MANAGER: '#059669', SALES_MANAGER: '#D97706',
      ACCOUNTANT: '#0891B2', VIEWER: '#6B7280',
    };
    return map[role] || '#3B82F6';
  }

  getRoleDotClass(role: string): string {
    const map: Record<string, string> = {
      GLOBAL_ADMIN: 'bg-purple-500', ADMIN: 'bg-purple-500',
      BRANCH_ADMIN: 'bg-blue-500', BRANCH_MANAGER: 'bg-blue-500',
      ACADEMIC_MANAGER: 'bg-emerald-500', SALES_MANAGER: 'bg-amber-500',
      ACCOUNTANT: 'bg-cyan-500', VIEWER: 'bg-gray-400',
    };
    return map[role] || 'bg-gray-400';
  }

  formatRole(role: string): string {
    return ROLE_LABELS[role as UserRole] || role;
  }

  // ─── QR Scanner ──────────────────────────────────────────────────────────

  openQrScanner() {
    this.qrDialogVisible.set(true);
    // USB scanner is first priority: if one is known on this device, don't start
    // the camera (the always-on wedge handles scans). Camera is the explicit
    // fallback (see useCamera) for devices with no scanner.
    if (this.usbDetected()) return;
    this.cameraStarted.set(true);
    setTimeout(() => this.startQrCamera(), 300);
  }

  /** Explicit fallback: start the camera even when a USB scanner exists. */
  useCamera() {
    this.cameraStarted.set(true);
    setTimeout(() => this.startQrCamera(), 100);
  }

  closeQrScanner() {
    this.stopQrCamera();
    this.qrDialogVisible.set(false);
  }

  private async startQrCamera() {
    if (this.html5Qr) return;
    this.qrScanning.set(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      this.html5Qr = new Html5Qrcode(this.QR_SCANNER_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => this.handleQrScan(decodedText),
        () => {},
      );
    } catch {
      this.notifications.error(this.translate.instant('NAV.QR_CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.qrScanning.set(false);
    }
  }

  private stopQrCamera() {
    this.cameraStarted.set(false);
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  private handleQrScan(decodedText: string) {
    const token = this.extractQrToken(decodedText);
    if (!token || this.qrLookingUp()) return;
    this.qrLookingUp.set(true);
    this.studentService.lookupByQr(token).subscribe({
      next: (result) => {
        this.closeQrScanner();
        this.qrLookingUp.set(false);
        this.router.navigate(['/students', result.id]);
      },
      error: () => {
        this.notifications.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND'));
        this.qrLookingUp.set(false);
      },
    });
  }

  private extractQrToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  ngOnDestroy() {
    this.stopQrCamera();
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
