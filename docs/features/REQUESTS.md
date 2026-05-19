# Feature Requests & Design Decisions

## ✅ Completed

### Product Inventory & COGS Tracking
**Request:** Buying stock (e.g., 15 units × 15 EGP cost) should be reflected in the dashboard.
**Solution:** Implemented matching principle accounting:
- Inventory purchase = asset (not expense). Stock tracked on `products` table with `cost_price`.
- COGS expense auto-created on sale date: `cost_price × quantity`, category `COGS`, linked to `product_sale_id`.
- DB: Added `product_sale_id`, `product_id` columns to `expenses`; COGS added to category constraint.
- Analytics: `grossProfit = totalRevenue - cogsExpenses`, `inventoryValue = SUM(stock × cost_price)`.
- Dashboard now returns: `grossProfit`, `cogsExpenses`, `capitalExpenses`, `inventoryValue`.

---

### Capital Expenditure (CapEx) for Expenses
**Request:** Assets like laptops, air conditioners, decorations should not be counted as a single month's expense.
**Solution:** Added `CAPITAL` expense type with amortization:
- `assetName` — name of the asset (e.g. "MacBook Pro")
- `amortizationMonths` — number of months to spread the cost over
- `monthlyAmount` — computed as `amount ÷ amortizationMonths`, returned by API
- Analytics should use `monthlyAmount` instead of `amount` for CAPITAL expenses
- Form shows a highlighted capital section when type = CAPITAL, with live monthly cost preview
- DB columns added: `asset_name`, `amortization_months`

---

### Student Acquisition Channel (Source)
**Request:** Add a dropdown on the Add New Student form for "channel" — how the student heard about us.
**Solution:** Added `acquisition_channel` column on `students` (VARCHAR(50), nullable).
- Options: FACEBOOK, INSTAGRAM, TWITTER, TIKTOK, REFERRAL, WALK_IN, OTHER.
- API contract: `acquisitionChannel` on create/update/return payloads, validated via Zod enum.
- Migration: `POST /api/migrations/add-acquisition-channel-to-students` (idempotent — `ADD COLUMN IF NOT EXISTS`).
- Frontend: dropdown on Add/Edit Student form (Student Information section, optional). Detail page shows "Heard via:" when set. EN + AR labels.

---

### Backdated Employee Salary Calculation
**Request:** When registering an employee whose actual hire date is in the past (e.g. hired 20/1/2026 but registered 15/3/2026), automatically calculate and add back-salary expenses.
**Solution:** "Calculate Back Pay" button on the employee detail page (shown only when employee has both `hireDate` and `salary`).
- Generates monthly periods from hire month through the month *before* the registration/current month — the registration month itself is excluded since it's paid normally at month-end.
- First month is pro-rated if hire day > 1 (`salary × daysWorked ÷ daysInMonth`).
- Idempotent: months that already have a SALARIES `expense_payments` row are flagged `alreadyPaid` and skipped on commit.
- Preview (`GET /api/expenses/employee/:id/back-pay-preview?upTo=YYYY-MM-DD`) lists every period (month, dates, days, amount, status) before commit.
- Commit (`POST /api/expenses/employee/:id/back-pay`) writes `expense_payments` rows: `type=FIXED`, `category=SALARIES`, `employee_id=set`, `expense_id=null`, `date=end-of-month`, with pro-rated note when applicable.

---

## 🕐 Pending

_None right now — add new requests below._
