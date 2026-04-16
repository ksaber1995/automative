-- Migration 015: Drop budget column from events
--
-- Budget tracking is removed. Per-event financial health is now expressed
-- through the P&L (revenue, expenses, refunds, product margin, net profit)
-- without a separate budget target.

ALTER TABLE events DROP COLUMN IF EXISTS budget;
