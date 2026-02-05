-- Sample Users Data
-- Password for all users is: password123
-- Hashed with bcryptjs (10 rounds)

INSERT INTO users (id, email, password, first_name, last_name, role, branch_id, is_active) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Admin', 'User', 'ADMIN', NULL, true),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manager.dt@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Ahmed', 'Hassan', 'BRANCH_MANAGER', '11111111-1111-1111-1111-111111111111', true),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager.alx@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Fatima', 'Mohamed', 'BRANCH_MANAGER', '22222222-2222-2222-2222-222222222222', true),
('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager.gz@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Omar', 'Ali', 'BRANCH_MANAGER', '33333333-3333-3333-3333-333333333333', true),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'accountant.dt@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Sara', 'Ibrahim', 'ACCOUNTANT', '11111111-1111-1111-1111-111111111111', true),
('ffffffff-ffff-ffff-ffff-ffffffffffff', 'accountant.alx@automatemagic.com', '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO', 'Nour', 'Mahmoud', 'ACCOUNTANT', '22222222-2222-2222-2222-222222222222', true);

-- Update branches with manager IDs
UPDATE branches SET manager_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE branches SET manager_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' WHERE id = '22222222-2222-2222-2222-222222222222';
UPDATE branches SET manager_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE id = '33333333-3333-3333-3333-333333333333';
