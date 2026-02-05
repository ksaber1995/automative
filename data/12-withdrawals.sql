-- Sample Withdrawals Data

INSERT INTO withdrawals (id, branch_id, amount, date, reason, approved_by, status) VALUES
-- Downtown Branch Withdrawals
('00111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 5000.00, '2024-01-20', 'Emergency equipment repair', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'APPROVED'),
('00222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 3000.00, '2024-02-15', 'Staff bonus payment', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'APPROVED'),
('00333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 2500.00, '2024-03-10', 'Marketing materials printing', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PENDING'),

-- Alexandria Branch Withdrawals
('00444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 4000.00, '2024-01-25', 'New furniture for classrooms', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'APPROVED'),
('00555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 1500.00, '2024-02-20', 'Office supplies bulk purchase', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'APPROVED'),
('00666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 3500.00, '2024-03-05', 'Software licenses upgrade', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PENDING'),

-- Giza Branch Withdrawals
('00777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', 6000.00, '2024-02-01', 'Server upgrade and maintenance', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'APPROVED'),
('00888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', 2000.00, '2024-02-25', 'Conference attendance fees', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'APPROVED'),
('00999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 1800.00, '2024-03-15', 'Team building activity', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'REJECTED');
