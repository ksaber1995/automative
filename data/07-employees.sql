-- Sample Employees Data

INSERT INTO employees (id, first_name, last_name, email, position, salary, branch_id, is_global, is_active) VALUES
-- Global Employees (work across all branches)
('e0011111-1111-1111-1111-111111111111', 'Ahmed', 'Zaki', 'ahmed.zaki@automatemagic.com', 'CEO', 50000.00, NULL, true, true),
('e0022222-2222-2222-2222-222222222222', 'Dina', 'Waheed', 'dina.waheed@automatemagic.com', 'CTO', 40000.00, NULL, true, true),
('e0033333-3333-3333-3333-333333333333', 'Sherif', 'Adel', 'sherif.adel@automatemagic.com', 'CFO', 38000.00, NULL, true, true),

-- Downtown Branch Employees
('e0044444-4444-4444-4444-444444444444', 'Mona', 'Fathy', 'mona.fathy@automatemagic.com', 'Senior Instructor', 12000.00, '11111111-1111-1111-1111-111111111111', false, true),
('e0055555-5555-5555-5555-555555555555', 'Tamer', 'Hosny', 'tamer.hosny@automatemagic.com', 'Instructor', 9000.00, '11111111-1111-1111-1111-111111111111', false, true),
('e0066666-6666-6666-6666-666666666666', 'Rana', 'Sameh', 'rana.sameh@automatemagic.com', 'Receptionist', 5000.00, '11111111-1111-1111-1111-111111111111', false, true),
('e0077777-7777-7777-7777-777777777777', 'Khaled', 'Youssef', 'khaled.youssef@automatemagic.com', 'IT Support', 7000.00, '11111111-1111-1111-1111-111111111111', false, true),

-- Alexandria Branch Employees
('e0088888-8888-8888-8888-888888888888', 'Nadia', 'Salem', 'nadia.salem@automatemagic.com', 'Senior Instructor', 11500.00, '22222222-2222-2222-2222-222222222222', false, true),
('e0099999-9999-9999-9999-999999999999', 'Mahmoud', 'Kamal', 'mahmoud.kamal@automatemagic.com', 'Instructor', 8500.00, '22222222-2222-2222-2222-222222222222', false, true),
('e00aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Huda', 'Nabil', 'huda.nabil@automatemagic.com', 'Receptionist', 4800.00, '22222222-2222-2222-2222-222222222222', false, true),
('e00bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sami', 'Fouad', 'sami.fouad@automatemagic.com', 'Marketing Specialist', 8000.00, '22222222-2222-2222-2222-222222222222', false, true),

-- Giza Branch Employees
('e00ccccc-cccc-cccc-cccc-cccccccccccc', 'Laila', 'Mansour', 'laila.mansour@automatemagic.com', 'Senior Instructor', 12500.00, '33333333-3333-3333-3333-333333333333', false, true),
('e00ddddd-dddd-dddd-dddd-dddddddddddd', 'Wael', 'Bahgat', 'wael.bahgat@automatemagic.com', 'Instructor', 9500.00, '33333333-3333-3333-3333-333333333333', false, true),
('e00eeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Yasmin', 'Rifaat', 'yasmin.rifaat@automatemagic.com', 'Receptionist', 5200.00, '33333333-3333-3333-3333-333333333333', false, true),
('e00fffff-ffff-ffff-ffff-ffffffffffff', 'Bassem', 'Sabry', 'bassem.sabry@automatemagic.com', 'Lab Technician', 6500.00, '33333333-3333-3333-3333-333333333333', false, true);
