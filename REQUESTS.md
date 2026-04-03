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

## 🕐 Pending

### Student Acquisition Channel (Source)
**Request:** Add a dropdown on the Add New Student form for "channel" — how the student heard about us.
**Options:** Facebook, Instagram, Twitter, other client referral, walk-in, etc.
**Status:** To be implemented (backend + frontend + DB column `acquisition_channel`)

---

### Backdated Employee Salary Calculation
**Request:** When registering an employee whose actual hire date is in the past (e.g. hired 20/1/2026 but registered 15/3/2026), automatically calculate and add back-salary expenses:
- Rest of January salary (pro-rated from hire date)
- Full February salary
- March salary gets discounted at month-end
**Decision:** Best approach is to add a "Calculate Back Pay" action on the employee detail page. When triggered:
1. Compute months between `hireDate` and registration date
2. Create expense entries (type: FIXED, category: SALARIES) for each owed period, pro-rated for partial months
3. Show a preview/confirmation before creating the expenses
**Status:** To be implemented
