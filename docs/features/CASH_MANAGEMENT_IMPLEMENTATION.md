# Cash Management System Implementation Guide

## 📋 Overview

The cash management system adds real cash flow tracking to the application, separating actual cash on hand from accounting profit. This is critical because:

- **Net Profit ≠ Current Cash** due to timing differences, credit transactions, and unreported items
- **Stakeholders withdraw cash** which reduces available cash but doesn't affect historical profit
- **Debts and loans** affect cash flow but need separate tracking from operational expenses

---

## 🎯 Features to Implement

### 1. Current Cash Tracking

**Purpose:** Track the actual cash the business has available right now.

**Initial State:**
```typescript
currentCash = netProfit // Starting point
```

**Cash Equation:**
```
Current Cash = Initial Cash
             + Total Revenue (paid)
             - Total Expenses (paid)
             - Stakeholder Withdrawals
             + Debt Taken
             - Debt Payments
```

**Dashboard Display:**
```
┌─────────────────────────────────┐
│  Financial Overview             │
├─────────────────────────────────┤
│  Net Profit (Accounting)  $XXX  │
│  Current Cash (Actual)    $XXX ⭐│
│  Outstanding Debts        $XXX  │
│  Available Cash           $XXX  │
│  (Current - Debts)              │
└─────────────────────────────────┘
```

---

### 2. Stakeholder Withdrawals

**Purpose:** Track when owners/partners take money out of the business.

**Use Cases:**
- Owner draws/distributions
- Partner profit sharing
- Dividend payments
- Personal expenses paid by business

**Business Rules:**
- Only ADMIN can create withdrawals
- Withdrawal immediately reduces current cash
- Cannot withdraw more than available cash
- Each withdrawal must have a reason
- Track which stakeholder received the money

---

### 3. Debt/Loan Management

**Purpose:** Track borrowed money and repayment schedules.

**Types of Debts:**
- **Bank loans** - Formal loans with interest
- **Lines of credit** - Revolving credit
- **Investor loans** - Funding from investors
- **Vendor credit** - Payment terms from suppliers

**Business Rules:**
- Taking a debt **increases** current cash
- Debt payments **decrease** current cash
- Track principal vs. interest separately
- Calculate remaining balance
- Alert when payments are due

---

## 💾 Data Models

### Current Cash State

```typescript
// Store in settings or as a single record
interface CashState {
  id: string;
  currentCash: number;
  lastUpdated: string;
  lastTransactionId: string; // For audit trail
  lastTransactionType: 'REVENUE' | 'EXPENSE' | 'WITHDRAWAL' | 'DEBT_TAKEN' | 'DEBT_PAYMENT';
}
```

### Withdrawal Model

```typescript
interface Withdrawal {
  id: string;
  amount: number;
  stakeholderName: string;
  stakeholderEmail?: string;
  withdrawalDate: string;
  reason: string;
  category: 'OWNER_DRAW' | 'PROFIT_DISTRIBUTION' | 'DIVIDEND' | 'OTHER';
  paymentMethod: 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'OTHER';
  branchId?: string; // If withdrawal is from specific branch
  approvedBy: string; // User ID who approved
  notes?: string;
  receiptUrl?: string; // Optional receipt/documentation
  isActive: boolean; // For soft delete
  createdAt: string;
  updatedAt: string;
}
```

### Debt Model

```typescript
interface Debt {
  id: string;
  debtType: 'BANK_LOAN' | 'LINE_OF_CREDIT' | 'INVESTOR_LOAN' | 'VENDOR_CREDIT' | 'OTHER';
  creditorName: string;
  creditorContact?: string;
  principalAmount: number; // Original loan amount
  interestRate: number; // Annual percentage (e.g., 5.5 for 5.5%)
  compoundingFrequency: 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  takenDate: string;
  dueDate: string;
  paymentSchedule: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY' | 'LUMP_SUM';
  minimumPayment?: number;

  currentBalance: number; // Principal remaining
  totalInterestPaid: number; // Cumulative interest paid
  totalPaid: number; // Cumulative total paid (principal + interest)

  status: 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED' | 'REFINANCED';
  branchId?: string;

  collateral?: string; // What was pledged as security
  notes?: string;
  contractUrl?: string; // Link to loan agreement

  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Debt Payment Model

```typescript
interface DebtPayment {
  id: string;
  debtId: string;
  paymentDate: string;
  totalAmount: number; // Total payment made
  principalAmount: number; // Amount toward principal
  interestAmount: number; // Amount toward interest
  lateFee?: number; // Any late payment fees

  paymentMethod: 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'AUTO_DEBIT' | 'OTHER';
  referenceNumber?: string; // Check number, transaction ID, etc.

  balanceAfter: number; // Remaining principal after this payment
  notes?: string;
  receiptUrl?: string;

  createdAt: string;
  updatedAt: string;
}
```

---

## 🔌 API Endpoints

### Current Cash Management

```typescript
// Get current cash state
GET /api/cash/current
Response: { currentCash: number, lastUpdated: string }

// Manually adjust cash (ADMIN only - for corrections)
POST /api/cash/adjust
Body: {
  amount: number,           // Can be positive or negative
  reason: string,
  adjustmentType: 'CORRECTION' | 'INITIAL_BALANCE' | 'OTHER'
}

// Get cash flow history
GET /api/cash/flow?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
Response: Array of all transactions affecting cash
```

### Withdrawals

```typescript
// Create withdrawal
POST /api/withdrawals
Body: Withdrawal (without id, timestamps)
Auth: ADMIN only

// Get all withdrawals
GET /api/withdrawals?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
Auth: ADMIN, ACCOUNTANT

// Get withdrawals by stakeholder
GET /api/withdrawals/stakeholder/:name
Auth: ADMIN

// Get specific withdrawal
GET /api/withdrawals/:id
Auth: ADMIN, ACCOUNTANT

// Update withdrawal (within 24 hours only)
PATCH /api/withdrawals/:id
Body: Partial<Withdrawal>
Auth: ADMIN

// Soft delete withdrawal
DELETE /api/withdrawals/:id
Auth: ADMIN
```

### Debts

```typescript
// Create debt (record new loan)
POST /api/debts
Body: Debt (without id, timestamps, calculated fields)
Auth: ADMIN only

// Get all debts
GET /api/debts?status=ACTIVE
Auth: ADMIN, BRANCH_MANAGER, ACCOUNTANT

// Get specific debt with payment history
GET /api/debts/:id?includePayments=true
Auth: ADMIN, ACCOUNTANT

// Update debt details
PATCH /api/debts/:id
Body: Partial<Debt>
Auth: ADMIN

// Mark debt as paid off
POST /api/debts/:id/payoff
Body: { finalPaymentAmount: number, payoffDate: string }
Auth: ADMIN

// Soft delete debt (if mistake)
DELETE /api/debts/:id
Auth: ADMIN
```

### Debt Payments

```typescript
// Record debt payment
POST /api/debts/:debtId/payments
Body: {
  paymentDate: string,
  totalAmount: number,
  paymentMethod: string,
  notes?: string
}
// Backend calculates principal/interest split
Auth: ADMIN, ACCOUNTANT

// Get payment history for a debt
GET /api/debts/:debtId/payments
Auth: ADMIN, ACCOUNTANT

// Update payment (within 24 hours)
PATCH /api/debts/:debtId/payments/:paymentId
Body: Partial<DebtPayment>
Auth: ADMIN

// Delete payment (within 24 hours)
DELETE /api/debts/:debtId/payments/:paymentId
Auth: ADMIN
```

---

## 🎨 Frontend UI Components

### Dashboard Widget

**Location:** `frontend/src/app/features/dashboard/`

```html
<div class="cash-overview-card">
  <h3>Cash Position</h3>

  <div class="metric-row">
    <span class="label">Current Cash</span>
    <span class="value primary">${{ currentCash | number }}</span>
  </div>

  <div class="metric-row">
    <span class="label">Outstanding Debts</span>
    <span class="value danger">${{ totalDebts | number }}</span>
  </div>

  <div class="metric-row highlighted">
    <span class="label">Available Cash</span>
    <span class="value">${{ availableCash | number }}</span>
  </div>

  <div class="actions">
    <button (click)="recordWithdrawal()">Record Withdrawal</button>
    <button (click)="viewCashFlow()">Cash Flow</button>
  </div>
</div>
```

### Withdrawal Management Page

**Location:** `frontend/src/app/features/withdrawals/`

**Components:**
- `withdrawal-list.component` - List all withdrawals with filters
- `withdrawal-form.component` - Create/edit withdrawal
- `withdrawal-detail.component` - View single withdrawal

**Features:**
- Filter by date range, stakeholder, amount
- Sort by date, amount, stakeholder
- Export to Excel/PDF
- Search functionality
- Monthly/yearly summaries

### Debt Management Page

**Location:** `frontend/src/app/features/debts/`

**Components:**
- `debt-list.component` - List all debts
- `debt-form.component` - Create/edit debt
- `debt-detail.component` - View debt with payment history
- `debt-payment-form.component` - Record payment

**Features:**
- View active vs. paid-off debts
- Payment calculator (shows amortization)
- Alert when payment is due soon
- Track total interest paid
- Payment schedule calendar view

### Cash Flow Statement

**Location:** `frontend/src/app/features/reports/cash-flow/`

**Shows:**
```
Cash Flow Statement
Period: Jan 1 - Dec 31, 2026

Opening Cash Balance:              $10,000

Operating Activities:
  Revenue Received:                +$50,000
  Expenses Paid:                   -$30,000
  Net Cash from Operations:         $20,000

Financing Activities:
  Stakeholder Withdrawals:         -$5,000
  Debt Taken:                      +$10,000
  Debt Payments:                   -$8,000
  Net Cash from Financing:         -$3,000

Net Change in Cash:                 $17,000
Closing Cash Balance:              $27,000
```

---

## 🏗️ Implementation Steps

### Phase 1: Backend Foundation (2-3 days)

1. **Create Data Files**
   ```bash
   data/cash-state.json
   data/withdrawals.json
   data/debts.json
   data/debt-payments.json
   ```

2. **Update File Paths Constant**
   ```typescript
   // backend/src/data-store/file-paths.constant.ts
   CASH_STATE: join(DATA_DIR, 'cash-state.json'),
   WITHDRAWALS: join(DATA_DIR, 'withdrawals.json'),
   DEBTS: join(DATA_DIR, 'debts.json'),
   DEBT_PAYMENTS: join(DATA_DIR, 'debt-payments.json'),
   ```

3. **Create Modules**
   ```
   backend/src/cash/
   ├── cash.controller.ts
   ├── cash.service.ts
   ├── cash.module.ts
   └── dto/
       └── adjust-cash.dto.ts

   backend/src/withdrawals/
   ├── withdrawals.controller.ts
   ├── withdrawals.service.ts
   ├── withdrawals.module.ts
   └── dto/
       ├── create-withdrawal.dto.ts
       └── update-withdrawal.dto.ts

   backend/src/debts/
   ├── debts.controller.ts
   ├── debts.service.ts
   ├── debts.module.ts
   └── dto/
       ├── create-debt.dto.ts
       ├── update-debt.dto.ts
       └── create-payment.dto.ts
   ```

4. **Register Modules in app.module.ts**

5. **Create Shared Interfaces**
   ```
   shared/interfaces/
   ├── cash-state.interface.ts
   ├── withdrawal.interface.ts
   ├── debt.interface.ts
   └── debt-payment.interface.ts
   ```

### Phase 2: Frontend Services (1 day)

1. **Create Services**
   ```typescript
   frontend/src/app/features/cash/services/cash.service.ts
   frontend/src/app/features/withdrawals/services/withdrawal.service.ts
   frontend/src/app/features/debts/services/debt.service.ts
   ```

### Phase 3: Dashboard Integration (1 day)

1. **Add Cash Widget to Dashboard**
   - Show current cash prominently
   - Show outstanding debts
   - Calculate available cash
   - Quick action buttons

2. **Update Analytics Service**
   - Include cash state in dashboard metrics
   - Add cash flow calculations

### Phase 4: Withdrawal Management (2 days)

1. **Create Components**
   - Withdrawal list with table
   - Withdrawal form with validation
   - Withdrawal detail view

2. **Add Routing**
   ```typescript
   { path: 'withdrawals', component: WithdrawalListComponent }
   { path: 'withdrawals/new', component: WithdrawalFormComponent }
   { path: 'withdrawals/:id', component: WithdrawalDetailComponent }
   ```

3. **Add to Navigation Menu**

### Phase 5: Debt Management (2-3 days)

1. **Create Components**
   - Debt list with status filters
   - Debt form with calculator
   - Debt detail with payment history
   - Payment recording form

2. **Add Payment Calculator**
   - Calculate monthly payment
   - Show amortization schedule
   - Calculate total interest

3. **Add Routing and Navigation**

### Phase 6: Cash Flow Reporting (1-2 days)

1. **Create Cash Flow Statement**
   - Operating activities
   - Financing activities
   - Net change calculation

2. **Add Export Functionality**
   - Export to Excel
   - Export to PDF

### Phase 7: Testing & Refinement (1-2 days)

1. **Test All Endpoints**
2. **Verify Cash Calculations**
3. **Test Debt Interest Calculations**
4. **User Acceptance Testing**

---

## 📊 Sample Data

### Initial Cash State
```json
{
  "cashState": {
    "id": "cash-state-001",
    "currentCash": 25000,
    "lastUpdated": "2026-01-31T12:00:00.000Z",
    "lastTransactionId": "rev-001",
    "lastTransactionType": "REVENUE"
  }
}
```

### Sample Withdrawal
```json
{
  "id": "withdraw-001",
  "amount": 5000,
  "stakeholderName": "John Smith",
  "stakeholderEmail": "john@example.com",
  "withdrawalDate": "2026-01-15",
  "reason": "Monthly owner draw",
  "category": "OWNER_DRAW",
  "paymentMethod": "BANK_TRANSFER",
  "approvedBy": "admin-001",
  "notes": "Regular monthly distribution",
  "isActive": true,
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-01-15T10:00:00.000Z"
}
```

### Sample Debt
```json
{
  "id": "debt-001",
  "debtType": "BANK_LOAN",
  "creditorName": "First National Bank",
  "creditorContact": "555-0100",
  "principalAmount": 50000,
  "interestRate": 5.5,
  "compoundingFrequency": "MONTHLY",
  "takenDate": "2026-01-01",
  "dueDate": "2031-01-01",
  "paymentSchedule": "MONTHLY",
  "minimumPayment": 950,
  "currentBalance": 48500,
  "totalInterestPaid": 450,
  "totalPaid": 1950,
  "status": "ACTIVE",
  "notes": "Business expansion loan",
  "isActive": true,
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-31T10:00:00.000Z"
}
```

---

## 🔐 Security & Permissions

### Role Access

| Feature | Admin | Branch Manager | Accountant |
|---------|-------|----------------|------------|
| View Current Cash | ✅ | ✅ | ✅ |
| Adjust Cash | ✅ | ❌ | ❌ |
| Create Withdrawal | ✅ | ❌ | ❌ |
| View Withdrawals | ✅ | ❌ | ✅ |
| Create Debt | ✅ | ❌ | ❌ |
| View Debts | ✅ | ✅ | ✅ |
| Record Payment | ✅ | ❌ | ✅ |
| Delete Transactions | ✅ | ❌ | ❌ |

### Audit Trail

Every cash-affecting transaction should log:
- User who performed action
- Timestamp
- Previous value
- New value
- Reason (if applicable)

---

## 📈 Benefits

1. **Accurate Cash Tracking** - Know exactly how much cash you have
2. **Transparency** - All withdrawals and debts documented
3. **Better Planning** - Understand true cash position
4. **Debt Management** - Track all loans and payments
5. **Financial Reports** - Generate cash flow statements
6. **Audit Ready** - Complete transaction history

---

## 🎯 Success Metrics

- Current Cash displayed on dashboard ✅
- Withdrawals reduce current cash correctly ✅
- Debts increase/decrease cash as expected ✅
- Cash flow statement balances ✅
- All transactions have audit trail ✅
- User permissions enforced ✅

---

**Document Version:** 1.0
**Created:** January 31, 2026
**Status:** Ready for Implementation
