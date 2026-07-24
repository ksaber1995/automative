-- 078: drop the QR-activation columns from students.
--
-- qr_activated / qr_price / qr_paid / qr_expiration existed for a paid unlock
-- that only applied to TEACHER companies: a teacher bought QR access per student
-- (25 EGP for a year, 40 lifelong) and the owner ticked qr_paid once they
-- settled. That gate is gone — the QR is free for every tenant.
--
-- The columns had already stopped meaning anything and had started doing harm:
-- students.ts hardcoded qrActivated = true while monthly-subscriptions.ts still
-- read the raw column, so 1,066 teacher-tenant students showed their code on one
-- page and not the other. The gate was removed in the frontend first; this
-- removes the storage behind it.
--
-- What is being discarded, measured before writing this:
--   qr_paid = true          1,006 rows — 1,005 of them on the owner's own test
--                           tenant, 1 on a real client
--   qr_price NOT NULL       1,009 rows, SUM = 75.00 across all 4,235 students
--   qr_expiration NOT NULL  4 rows
-- So the "billing history" is one real row and 75 EGP. Confirmed with the owner
-- before dropping.
--
-- NOT dropped: students.qr_token. That is the QR code itself — it drives the
-- public profile and check-in scanning, and has nothing to do with activation.
--
-- ORDER MATTERS: deploy the API that no longer selects these columns FIRST.
-- Five queries in monthly-subscriptions.ts selected qr_expiration; dropping
-- ahead of that deploy turns them into a 500.

ALTER TABLE students DROP COLUMN IF EXISTS qr_activated;
ALTER TABLE students DROP COLUMN IF EXISTS qr_price;
ALTER TABLE students DROP COLUMN IF EXISTS qr_paid;
ALTER TABLE students DROP COLUMN IF EXISTS qr_expiration;
