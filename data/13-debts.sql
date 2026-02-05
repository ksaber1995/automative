-- Sample Debts Data

INSERT INTO debts (id, branch_id, creditor_name, amount, remaining_amount, description, date, due_date, status) VALUES
-- Global/Company Debts
('d1111111-1111-1111-1111-111111111111', NULL, 'Bank Loan - Business Expansion', 500000.00, 350000.00, 'Business loan for opening new branches', '2023-06-01', '2026-06-01', 'ACTIVE'),
('d2222222-2222-2222-2222-222222222222', NULL, 'IT Equipment Vendor', 80000.00, 40000.00, 'Computer and lab equipment purchase - installment plan', '2023-09-15', '2024-09-15', 'ACTIVE'),

-- Downtown Branch Debts
('d3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Office Furniture Supplier', 25000.00, 10000.00, 'New classroom furniture - installment payment', '2023-12-01', '2024-06-01', 'ACTIVE'),
('d4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Construction Company', 50000.00, 0.00, 'Renovation and remodeling work', '2023-08-15', '2024-02-15', 'PAID'),

-- Alexandria Branch Debts
('d5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'Design Software Vendor', 18000.00, 6000.00, 'Adobe Creative Cloud enterprise licenses', '2024-01-01', '2024-12-31', 'ACTIVE'),
('d6666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Marketing Agency', 15000.00, 15000.00, 'Social media campaign - payment delayed', '2024-02-01', '2024-03-31', 'OVERDUE'),

-- Giza Branch Debts
('d7777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', 'Cloud Provider - AWS', 30000.00, 22000.00, 'AWS services - annual commitment', '2024-01-15', '2025-01-15', 'ACTIVE'),
('d8888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', 'Network Infrastructure Co.', 12000.00, 4000.00, 'Network setup and cabling', '2023-11-01', '2024-05-01', 'ACTIVE');
