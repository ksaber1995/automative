-- Sample Products Data

INSERT INTO products (id, branch_id, name, code, description, price, cost, stock_quantity, min_stock_level, is_active) VALUES
-- Downtown Branch Products
('f0111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Programming Book - Python', 'BOOK-PY-001', 'Comprehensive Python programming guide', 250.00, 150.00, 45, 10, true),
('f0222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'USB Flash Drive 32GB', 'USB-32GB-001', 'USB 3.0 flash drive for course materials', 120.00, 70.00, 80, 20, true),
('f0333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Notebook - Coding Journal', 'NOTE-CODE-001', 'Lined notebook for code practice', 50.00, 25.00, 100, 30, true),
('f0444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Course Certificate Frame', 'FRAME-CERT-001', 'Premium certificate frame', 180.00, 100.00, 25, 5, true),
('f0555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Wireless Mouse', 'MOUSE-WL-001', 'Ergonomic wireless mouse', 150.00, 90.00, 35, 10, true),

-- Alexandria Branch Products
('f0666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Design Software License', 'SW-DESIGN-001', 'Adobe Creative Cloud 1-year student license', 1200.00, 800.00, 15, 5, true),
('f0777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'Drawing Tablet', 'TABLET-DRAW-001', 'Wacom drawing tablet for designers', 800.00, 500.00, 12, 3, true),
('f0888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'Marketing Toolkit Book', 'BOOK-MKT-001', 'Digital marketing essentials guide', 200.00, 120.00, 50, 15, true),
('f0999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'Portfolio Binder', 'BIND-PORT-001', 'Professional portfolio binder', 80.00, 45.00, 60, 20, true),
('f0a11111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Branded T-Shirt', 'TSHIRT-ALX-001', 'Automate Magic branded t-shirt', 120.00, 60.00, 40, 15, true),

-- Giza Branch Products
('f0a22222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'AWS Study Guide', 'BOOK-AWS-001', 'AWS Solutions Architect certification guide', 350.00, 200.00, 30, 8, true),
('f0a33333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Cybersecurity Toolkit', 'KIT-SEC-001', 'Ethical hacking tools and resources', 500.00, 300.00, 20, 5, true),
('f0a44444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'External Hard Drive 1TB', 'HDD-1TB-001', 'Portable external storage', 400.00, 250.00, 25, 8, true),
('f0a55555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'HDMI Cable', 'CABLE-HDMI-001', '2m HDMI cable for presentations', 60.00, 30.00, 70, 20, true),
('f0a66666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'Keyboard - Mechanical', 'KEYB-MECH-001', 'RGB mechanical keyboard', 350.00, 200.00, 18, 5, true);
