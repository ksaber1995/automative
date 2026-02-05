-- Sample Branches Data
-- Run this first as other tables depend on branches

INSERT INTO branches (id, name, code, address, city, state, zip_code, phone, email, opening_date, is_active) VALUES
('11111111-1111-1111-1111-111111111111', 'Downtown Branch', 'DT001', '123 Main Street', 'Cairo', 'Cairo', '11511', '+20-2-1234-5678', 'downtown@automatemagic.com', '2023-01-15', true),
('22222222-2222-2222-2222-222222222222', 'Alexandria Branch', 'ALX001', '456 Coastal Road', 'Alexandria', 'Alexandria', '21500', '+20-3-9876-5432', 'alexandria@automatemagic.com', '2023-06-20', true),
('33333333-3333-3333-3333-333333333333', 'Giza Branch', 'GZ001', '789 Pyramid Avenue', 'Giza', 'Giza', '12345', '+20-2-5555-6666', 'giza@automatemagic.com', '2024-01-10', true);
