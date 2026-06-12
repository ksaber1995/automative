# Feature Plan: Educational Books — Course-linked Products

## The idea in one paragraph

A course can be **linked to one or more products** (usually books). When a student enrolls, the
enrollment screen offers those linked products so they can **enroll and buy in one step** (optionally
at a discount), and that purchase is **tied to the student**. Buying is never forced — so we need an
**Educational Books** page that, per course, lists each linked product and shows **who bought it and
who didn't** among the enrolled students, with a one-click **"sell now"** action (same discount
available later as at enrollment). A teacher can **add another product mid-course**; because
"bought / not bought" is computed live, the new product immediately shows up as *not bought yet* on
every enrolled student's page, with a buy option. Required vs optional is a per-link flag, so both
"must buy" books and "nice to have" extras are supported.

---

## 1. Key design decision: reuse `product_sales`, don't invent a parallel ledger

A student buying a book **is** a product sale. `product_sales` already:
- decrements stock,
- auto-creates the COGS expense,
- is refundable (`refunds.product_sale_id`),
- shows up as revenue (the revenues list `PRODUCT_SALE` source).

So instead of a new "book purchases" table, we **link a sale to a student + course** and reuse all of
that. "Who bought" = the enrolled students who have a (non-fully-refunded) `product_sales` row for
that `(course_id, product_id)`. "Who didn't" = the rest of the enrolled roster. This keeps revenue,
refunds and inventory correct for free.

Today `product_sales` has only free-text `customer_name`/`customer_phone` and **no `student_id`** — so
the first change is to make a sale attributable to a student and a course.

---

## 2. Data model changes

Schema lives in `aws/sql/schema.sql`; the live DB is migrated by a numbered file in
`aws/sql/migrations/` plus the runtime `ensure…` guard pattern this codebase uses.

### 2a. New table `course_products` — the link itself
```sql
CREATE TABLE course_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    -- "needs to buy" (true) vs optional extra (false). Mid-course adds are usually false.
    is_required BOOLEAN NOT NULL DEFAULT true,
    -- The standard course discount, applied as the default at enrollment time AND on the
    -- Educational Books page (staff can still override per sale).
    default_discount_type  VARCHAR(20) NOT NULL DEFAULT 'NONE'
        CHECK (default_discount_type IN ('NONE', 'PERCENTAGE', 'FIXED_AMOUNT')),
    default_discount_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
    -- When the teacher added this product to the course (mid-course adds are visible/sortable).
    added_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, product_id)
);
CREATE INDEX idx_course_products_course  ON course_products(course_id);
CREATE INDEX idx_course_products_product ON course_products(product_id);
CREATE INDEX idx_course_products_company ON course_products(company_id);
```

### 2b. Extend `product_sales` — attribute a sale to a student/course/enrollment
```sql
ALTER TABLE product_sales
  ADD COLUMN IF NOT EXISTS student_id    UUID REFERENCES students(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_id     UUID REFERENCES courses(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_sales_student    ON product_sales(student_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_course     ON product_sales(course_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_enrollment ON product_sales(enrollment_id);
```
- `student_id` — "this payment is linked to the student" (used everywhere a student's purchases show).
- `course_id` — which course's linked product this sale satisfies (the books page joins on it).
- `enrollment_id` — set when bought during enrollment; NULL when bought later from the books page.
- All nullable, so plain walk-in product sales are unaffected.

### 2c. `schema.sql` edits
- Add the `course_products` table right after the `product_sales` block (~line 931).
- Add the three columns + indexes to the `CREATE TABLE product_sales` block (~line 903).

### 2d. Migration file `aws/sql/migrations/030_course_products.sql`
> ⚠️ Use the next free number at implementation time. `029_student_qr.sql` is the highest on disk;
> if the attendance-magic plan also lands a `030`, bump this to `031`.

Idempotent: the `CREATE TABLE IF NOT EXISTS course_products (...)`, the `ALTER TABLE … ADD COLUMN
IF NOT EXISTS` for `product_sales`, and all `CREATE INDEX IF NOT EXISTS`. No backfill needed
(existing sales simply have NULL student/course; existing courses have no links yet).

---

## 3. Backend changes (`aws/lambda/api/src`)

### New route module `routes/course-products.ts`
Manages the link (course-side admin: "link a product to a course", toggle required, set discount).
- `list` — `GET /api/course-products?courseId=` → links for a course (joined with product name, code,
  selling_price, stock).
- `link` — `POST /api/course-products` `{ courseId, productId, isRequired, defaultDiscountType,
  defaultDiscountValue }` → insert (ON CONFLICT (course_id, product_id) update). This is also the
  **mid-course add** path.
- `update` — `PATCH /api/course-products/:id` → toggle `isRequired` / change default discount.
- `unlink` — `DELETE /api/course-products/:id`.
- Permission: `academy` write (course management); `academy` read for list. All branch/company scoped
  via the course's company.

### New route module `routes/educational-books.ts` (the page's aggregate views)
- `courses` — `GET /api/educational-books/courses` → every course that has ≥1 linked product, with
  `{ courseId, courseName, branchId, linkedProductCount, enrolledCount, boughtCount, notBoughtCount }`
  for the summary cards. Branch-scoped via `appendBranchSqlFilter`.
- `courseDetail` — `GET /api/educational-books/course/:courseId` → for each linked product:
  `{ product, isRequired, defaultDiscount, buyers: [...], nonBuyers: [...] }` where buyers/non-buyers
  are drawn from the **current enrolled roster** (`enrollments` ∪ `master_class_enrollments`, not
  dropped/cancelled) left-joined to non-refunded `product_sales` on `(student_id, course_id,
  product_id)`. A student counts as a buyer when a matching sale exists with
  `total_amount - total_refunded > 0`.
- Permission: reuse `product_sales` read (it's a sales/who-paid view). No new RBAC resource needed.

### Extend `routes/product-sales.ts` → `create`
Accept optional `studentId`, `courseId`, `enrollmentId` and persist them (the INSERT already lists
columns explicitly — add the three). Everything else (stock, COGS, discount math) is unchanged. This
single endpoint now powers **"sell a book to a student later"** from the Educational Books page.
- `mapProductSaleFromDB` and the contract response gain `studentId`/`courseId`/`enrollmentId`.
- Optional: include `studentName` in `list`/`getById` via a `LEFT JOIN students`.

### Extend `routes/enrollments.ts` → `create` (enroll + buy in one step)
- Accept optional `products: [{ productId, quantity, discountType, discountValue }]`.
- Wrap the enrollment insert **and** the product sales in **one transaction** (refactor `create` to
  use `getClient()` + `BEGIN/COMMIT` like `product-sales.create`, or extract a shared
  `insertProductSale(client, …)` helper so the stock/COGS logic isn't duplicated).
- Each chosen product → a `product_sales` row with `student_id`, `course_id`, `enrollment_id` set,
  discount applied (defaulting to the `course_products` default, overridable). Stock + COGS handled
  per existing logic.
- If any product insert fails (e.g. out of stock), roll back the whole enrollment so we never half-
  commit. (Decision: treat a linked-product purchase failure as fatal to the enrollment, or skip &
  warn — recommend fatal + clear error.)

### `contract.ts`
- New `R_courseProducts` schemas + endpoints (`list`/`link`/`update`/`unlink`).
- New `educationalBooks` endpoints (`courses`, `courseDetail`) with response schemas
  (product summary, buyers/nonBuyers arrays).
- `RevenueItemSchema`/product-sale schemas: add `studentId`, `courseId`, `enrollmentId` (nullable).
- `productSales.create` body: add optional `studentId`, `courseId`, `enrollmentId`.
- `enrollments.create` body: add optional `products` array.

### `index.ts`
- Register `courseProducts: courseProductsRoutes` and `educationalBooks: educationalBooksRoutes`.

---

## 4. Frontend changes (`frontend/src/app`)

### New feature folder `features/educational-books/`
- `educational-books-list` — landing page (route `/educational-books`): cards/table of courses that
  have linked products, with bought / not-bought counts. Filter by branch.
- `educational-books-detail` — `/educational-books/:courseId`: per linked product, two lists
  (Bought / Not bought) over the enrolled roster, each non-buyer row with a **"Sell"** button that
  opens a small dialog (qty, discount prefilled from the link's default, payment method) → calls
  `productSales.create` with `studentId`+`courseId`. Required vs optional badge per product.
- `services/educational-books.service.ts` + `services/course-product.service.ts`.

### Course detail / form (`features/courses/course-detail`, `course-form`)
- A "Linked products (books)" section: list current `course_products`, add/remove a product, toggle
  required, set default discount. **Adding here is the mid-course add** — it instantly affects the
  books page and student pages.

### Enrollment form (`features/enrollments/enrollment-form`)
- After the course is chosen, fetch its linked products and render a checklist: each shows name,
  price, the default discount (editable), and a "buy now" checkbox (required ones pre-checked/locked
  per product policy). Submit the selected products in the `create` payload. Show the combined total
  (course final price + selected products).

### Student detail (`features/students/student-detail`)
- A "Books / products" section listing the student's `product_sales` (now that they carry
  `student_id`), showing course-linked purchases and **outstanding linked products not yet bought**
  for their enrolled courses, each with a "Sell" shortcut. This is the per-student reflection the
  request calls for.

### Navigation + i18n
- Add a sidebar item `NAV.EDUCATIONAL_BOOKS` (icon e.g. `pi pi-book`), visible on
  `auth.canRead('product_sales')` (and not teacher-restricted unless desired), in
  `core/layout/layout.component.ts`.
- Add the route in `app.routes.ts` guarded by `permissionGuard('product_sales')`.
- New i18n keys under `EDUCATIONAL_BOOKS.*`, `COURSES.*` (linked products section), and
  `ENROLLMENT_FORM.*` (buy-with-enrollment) in `en.json` + `ar.json`.

---

## 5. How each requirement maps
| Requirement | Where it's handled |
|---|---|
| Link a course to one or more products | `course_products` (UNIQUE course+product, many rows per course) |
| Student "needs to buy" the product | `course_products.is_required = true` |
| Buy at enrollment time, in one step | `enrollments.create` accepts `products[]`, one transaction |
| Purchase linked to the student | `product_sales.student_id` (+ `course_id`, `enrollment_id`) |
| Buying not mandatory | `is_required = false`, and required ones are still skippable per policy |
| Educational Books page: who bought / who didn't | `educational-books/course/:id` (roster ⟕ non-refunded sales) |
| Buy later from that page | "Sell" → `productSales.create` with student+course link |
| Discount at enrollment **or** later | `course_products.default_discount_*`, overridable in both flows |
| Teacher adds a product mid-course | `course-products.link` later; "bought/not" is computed live |
| Reflects on student pages | student-detail outstanding-books section, driven by `course_products` |

---

## 6. File-change checklist
| Area | File | Change |
|---|---|---|
| Migration | `aws/sql/migrations/030_course_products.sql` | **new** — `course_products` + `product_sales` columns |
| Schema | `aws/sql/schema.sql` | add `course_products`; add 3 cols to `product_sales` |
| API | `aws/lambda/api/src/routes/course-products.ts` | **new** — link CRUD |
| API | `aws/lambda/api/src/routes/educational-books.ts` | **new** — page aggregates |
| API | `aws/lambda/api/src/routes/product-sales.ts` | persist student/course/enrollment on `create` |
| API | `aws/lambda/api/src/routes/enrollments.ts` | `create` accepts `products[]`, one transaction |
| API | `aws/lambda/api/src/contract.ts` | new schemas/endpoints + field additions |
| API | `aws/lambda/api/src/index.ts` | register 2 new route groups |
| FE | `features/educational-books/**` | **new** list + detail + services |
| FE | `features/courses/course-detail` (+form) | linked-products management section |
| FE | `features/enrollments/enrollment-form` | buy-linked-products at enrollment |
| FE | `features/students/student-detail` | student's books + outstanding |
| FE | `core/layout/layout.component.ts`, `app.routes.ts` | nav item + guarded route |
| i18n | `frontend/src/assets/i18n/{en,ar}.json` | `EDUCATIONAL_BOOKS.*` + related keys |

---

## 7. Open decisions (sensible defaults chosen; confirm if you disagree)
1. **Required product at enrollment** — default: pre-checked but still skippable (we only *track* who
   didn't buy). Alternative: hard-block enrollment until required books are bought.
2. **Linked-product purchase failure during enrollment** — default: fatal (roll back enrollment).
3. **Permissions** — default: reuse `product_sales` (read = view page, write = sell) and `academy`
   (manage links). No new RBAC resource/migration. Switch to a dedicated `educational_books`
   resource only if you want separate access control.
4. **Refund of a book** — uses the existing product-sale refund flow unchanged.
