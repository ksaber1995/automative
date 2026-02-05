-- Sample Students Data

INSERT INTO students (id, first_name, last_name, date_of_birth, email, phone, parent_name, parent_phone, parent_email, address, branch_id, enrollment_date, is_active) VALUES
-- Downtown Branch Students
('b1111111-1111-1111-1111-111111111111', 'Mohamed', 'Ahmed', '2005-03-15', 'mohamed.ahmed@email.com', '+20-10-1234-5678', 'Ahmed Mohamed', '+20-10-9999-1111', 'parent1@email.com', '10 Tahrir Square, Cairo', '11111111-1111-1111-1111-111111111111', '2024-01-10', true),
('b2222222-2222-2222-2222-222222222222', 'Amira', 'Hassan', '2004-07-22', 'amira.hassan@email.com', '+20-11-2345-6789', 'Hassan Ali', '+20-11-8888-2222', 'parent2@email.com', '25 Zamalek, Cairo', '11111111-1111-1111-1111-111111111111', '2024-01-15', true),
('b3333333-3333-3333-3333-333333333333', 'Youssef', 'Ibrahim', '2006-11-08', 'youssef.ibrahim@email.com', '+20-12-3456-7890', 'Ibrahim Youssef', '+20-12-7777-3333', 'parent3@email.com', '42 Maadi, Cairo', '11111111-1111-1111-1111-111111111111', '2024-02-01', true),
('b4444444-4444-4444-4444-444444444444', 'Nada', 'Mahmoud', '2005-05-30', 'nada.mahmoud@email.com', '+20-10-4567-8901', 'Mahmoud Nada', '+20-10-6666-4444', 'parent4@email.com', '18 Heliopolis, Cairo', '11111111-1111-1111-1111-111111111111', '2024-01-20', true),
('b5555555-5555-5555-5555-555555555555', 'Karim', 'Said', '2003-09-12', 'karim.said@email.com', '+20-11-5678-9012', 'Said Karim', '+20-11-5555-5555', 'parent5@email.com', '35 Nasr City, Cairo', '11111111-1111-1111-1111-111111111111', '2024-02-10', true),

-- Alexandria Branch Students
('b6666666-6666-6666-6666-666666666666', 'Layla', 'Farouk', '2004-12-03', 'layla.farouk@email.com', '+20-10-6789-0123', 'Farouk Layla', '+20-10-4444-6666', 'parent6@email.com', '50 Corniche, Alexandria', '22222222-2222-2222-2222-222222222222', '2024-01-18', true),
('b7777777-7777-7777-7777-777777777777', 'Omar', 'Salah', '2005-04-25', 'omar.salah@email.com', '+20-11-7890-1234', 'Salah Omar', '+20-11-3333-7777', 'parent7@email.com', '88 Miami, Alexandria', '22222222-2222-2222-2222-222222222222', '2024-02-05', true),
('b8888888-8888-8888-8888-888888888888', 'Hana', 'Khaled', '2006-08-17', 'hana.khaled@email.com', '+20-12-8901-2345', 'Khaled Hana', '+20-12-2222-8888', 'parent8@email.com', '120 Stanley, Alexandria', '22222222-2222-2222-2222-222222222222', '2024-02-12', true),
('b9999999-9999-9999-9999-999999999999', 'Ali', 'Yasser', '2004-02-28', 'ali.yasser@email.com', '+20-10-9012-3456', 'Yasser Ali', '+20-10-1111-9999', 'parent9@email.com', '75 Smouha, Alexandria', '22222222-2222-2222-2222-222222222222', '2024-01-22', true),
('ba111111-1111-1111-1111-111111111111', 'Maryam', 'Adel', '2005-06-14', 'maryam.adel@email.com', '+20-11-0123-4567', 'Adel Maryam', '+20-11-0000-1111', 'parent10@email.com', '200 Sidi Gaber, Alexandria', '22222222-2222-2222-2222-222222222222', '2024-02-08', true),

-- Giza Branch Students
('ba222222-2222-2222-2222-222222222222', 'Hassan', 'Nabil', '2003-10-20', 'hassan.nabil@email.com', '+20-10-1234-5670', 'Nabil Hassan', '+20-10-9999-2222', 'parent11@email.com', '15 Dokki, Giza', '33333333-3333-3333-3333-333333333333', '2024-01-25', true),
('ba333333-3333-3333-3333-333333333333', 'Salma', 'Tarek', '2005-01-11', 'salma.tarek@email.com', '+20-11-2345-6781', 'Tarek Salma', '+20-11-8888-3333', 'parent12@email.com', '60 Mohandessin, Giza', '33333333-3333-3333-3333-333333333333', '2024-02-01', true),
('ba444444-4444-4444-4444-444444444444', 'Yousef', 'Gamal', '2004-09-05', 'yousef.gamal@email.com', '+20-12-3456-7892', 'Gamal Yousef', '+20-12-7777-4444', 'parent13@email.com', '32 Haram, Giza', '33333333-3333-3333-3333-333333333333', '2024-02-15', true),
('ba555555-5555-5555-5555-555555555555', 'Aya', 'Samy', '2006-03-27', 'aya.samy@email.com', '+20-10-4567-8903', 'Samy Aya', '+20-10-6666-5555', 'parent14@email.com', '90 Agouza, Giza', '33333333-3333-3333-3333-333333333333', '2024-02-20', true),
('ba666666-6666-6666-6666-666666666666', 'Ziad', 'Hossam', '2005-11-19', 'ziad.hossam@email.com', '+20-11-5678-9014', 'Hossam Ziad', '+20-11-5555-6666', 'parent15@email.com', '45 6th October, Giza', '33333333-3333-3333-3333-333333333333', '2024-03-01', true),

-- Churned Students (examples)
('ba777777-7777-7777-7777-777777777777', 'Nour', 'Essam', '2004-07-08', 'nour.essam@email.com', '+20-10-6789-0125', 'Essam Nour', '+20-10-4444-7777', 'parent16@email.com', '22 Imbaba, Giza', '33333333-3333-3333-3333-333333333333', '2023-09-01', false),
('ba888888-8888-8888-8888-888888888888', 'Adam', 'Ramy', '2005-12-30', 'adam.ramy@email.com', '+20-11-7890-1236', 'Ramy Adam', '+20-11-3333-8888', 'parent17@email.com', '100 Faisal, Giza', '11111111-1111-1111-1111-111111111111', '2023-10-15', false);

-- Update churned students with churn information
UPDATE students SET churn_date = '2024-01-15', churn_reason = 'Relocated to another city' WHERE id = 'ba777777-7777-7777-7777-777777777777';
UPDATE students SET churn_date = '2024-02-01', churn_reason = 'Financial difficulties' WHERE id = 'ba888888-8888-8888-8888-888888888888';
