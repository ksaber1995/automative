-- Sample Courses Data

-- Downtown Branch Courses
INSERT INTO courses (id, branch_id, name, code, description, price, duration, max_students, is_active) VALUES
('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Web Development Basics', 'WEB101', 'Learn HTML, CSS, and JavaScript fundamentals', 3000.00, 12, 20, true),
('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Advanced Python Programming', 'PY201', 'Master Python for data science and automation', 4500.00, 16, 15, true),
('c3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Mobile App Development', 'MOB301', 'Build iOS and Android apps with React Native', 5000.00, 20, 12, true),

-- Alexandria Branch Courses
('c4444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'Digital Marketing Essentials', 'DM101', 'Social media, SEO, and content marketing', 2500.00, 8, 25, true),
('c5555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'Graphic Design Pro', 'GD201', 'Adobe Photoshop, Illustrator, and InDesign', 3500.00, 14, 18, true),
('c6666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'UI/UX Design Masterclass', 'UX301', 'Design thinking and user experience principles', 4000.00, 16, 15, true),

-- Giza Branch Courses
('c7777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', 'Data Analytics with Excel', 'DA101', 'Excel, Power BI, and data visualization', 2800.00, 10, 20, true),
('c8888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333', 'Cloud Computing AWS', 'AWS201', 'Amazon Web Services fundamentals and certification prep', 5500.00, 18, 12, true),
('c9999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 'Cybersecurity Basics', 'SEC101', 'Network security and ethical hacking introduction', 4200.00, 14, 16, true);
