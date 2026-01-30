import { promises as fs } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';

const dataDir = join(__dirname, '..');

async function seedData() {
  console.log('🌱 Starting data seeding...\n');

  try {
    // Generate IDs
    const adminId = uuid();
    const managerId = uuid();
    const accountantId = uuid();
    const branch1Id = uuid();
    const branch2Id = uuid();
    const course1Id = uuid();
    const course2Id = uuid();
    const course3Id = uuid();
    const student1Id = uuid();
    const student2Id = uuid();
    const student3Id = uuid();
    const employee1Id = uuid();
    const employee2Id = uuid();
    const enrollment1Id = uuid();
    const enrollment2Id = uuid();
    const enrollment3Id = uuid();

    // Seed Users
    console.log('👤 Seeding users...');
    const users = {
      users: [
        {
          id: adminId,
          email: 'admin@automate-magic.com',
          password: await bcrypt.hash('admin123', 10),
          firstName: 'Admin',
          lastName: 'User',
          role: 'ADMIN',
          branchId: null,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: managerId,
          email: 'manager@automate-magic.com',
          password: await bcrypt.hash('manager123', 10),
          firstName: 'Branch',
          lastName: 'Manager',
          role: 'BRANCH_MANAGER',
          branchId: branch1Id,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: accountantId,
          email: 'accountant@automate-magic.com',
          password: await bcrypt.hash('accountant123', 10),
          firstName: 'Finance',
          lastName: 'Accountant',
          role: 'ACCOUNTANT',
          branchId: null,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'users.json'),
      JSON.stringify(users, null, 2)
    );
    console.log('✓ Users seeded\n');

    // Seed Branches
    console.log('🏢 Seeding branches...');
    const branches = {
      branches: [
        {
          id: branch1Id,
          name: 'Downtown Branch',
          code: 'DT001',
          address: '123 Main Street',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          phone: '+1-555-0100',
          email: 'downtown@automate-magic.com',
          managerId: managerId,
          isActive: true,
          openingDate: '2023-01-15',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: branch2Id,
          name: 'Westside Branch',
          code: 'WS002',
          address: '456 Oak Avenue',
          city: 'Los Angeles',
          state: 'CA',
          zipCode: '90001',
          phone: '+1-555-0200',
          email: 'westside@automate-magic.com',
          managerId: null,
          isActive: true,
          openingDate: '2023-06-01',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'branches.json'),
      JSON.stringify(branches, null, 2)
    );
    console.log('✓ Branches seeded\n');

    // Seed Courses
    console.log('📚 Seeding courses...');
    const courses = {
      courses: [
        {
          id: course1Id,
          name: 'Introduction to Robotics',
          code: 'ROB101',
          description: 'Learn the basics of robotics including mechanics, electronics, and programming.',
          price: 500.0,
          duration: '8 weeks',
          level: 'Beginner',
          branchId: branch1Id,
          maxStudents: 15,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: course2Id,
          name: 'Advanced Robotics',
          code: 'ROB201',
          description: 'Advanced robotics concepts including AI, machine learning, and autonomous systems.',
          price: 750.0,
          duration: '12 weeks',
          level: 'Advanced',
          branchId: branch1Id,
          maxStudents: 12,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: course3Id,
          name: 'Robot Programming',
          code: 'ROB102',
          description: 'Focus on programming robots using Python and Arduino.',
          price: 600.0,
          duration: '10 weeks',
          level: 'Intermediate',
          branchId: branch2Id,
          maxStudents: 15,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'courses.json'),
      JSON.stringify(courses, null, 2)
    );
    console.log('✓ Courses seeded\n');

    // Seed Students
    console.log('👦 Seeding students...');
    const students = {
      students: [
        {
          id: student1Id,
          firstName: 'Alice',
          lastName: 'Johnson',
          dateOfBirth: '2012-05-15',
          email: 'alice.j@example.com',
          phone: '+1-555-1001',
          parentName: 'Robert Johnson',
          parentPhone: '+1-555-1002',
          parentEmail: 'robert.j@example.com',
          address: '789 Elm Street, New York, NY 10002',
          branchId: branch1Id,
          isActive: true,
          enrollmentDate: '2024-01-15',
          notes: 'Very enthusiastic about robotics',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: student2Id,
          firstName: 'Bob',
          lastName: 'Smith',
          dateOfBirth: '2013-08-22',
          email: 'bob.s@example.com',
          phone: '+1-555-2001',
          parentName: 'Sarah Smith',
          parentPhone: '+1-555-2002',
          parentEmail: 'sarah.s@example.com',
          address: '321 Pine Street, New York, NY 10003',
          branchId: branch1Id,
          isActive: true,
          enrollmentDate: '2024-02-01',
          notes: 'Loves building robots',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: student3Id,
          firstName: 'Carol',
          lastName: 'Davis',
          dateOfBirth: '2011-11-10',
          email: 'carol.d@example.com',
          phone: '+1-555-3001',
          parentName: 'Michael Davis',
          parentPhone: '+1-555-3002',
          parentEmail: 'michael.d@example.com',
          address: '654 Maple Avenue, Los Angeles, CA 90002',
          branchId: branch2Id,
          isActive: true,
          enrollmentDate: '2024-01-20',
          notes: 'Advanced for her age',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'students.json'),
      JSON.stringify(students, null, 2)
    );
    console.log('✓ Students seeded\n');

    // Seed Enrollments
    console.log('📝 Seeding enrollments...');
    const enrollments = {
      enrollments: [
        {
          id: enrollment1Id,
          studentId: student1Id,
          courseId: course1Id,
          branchId: branch1Id,
          enrollmentDate: '2024-01-15',
          status: 'ACTIVE',
          originalPrice: 500.0,
          discountPercent: 10,
          discountAmount: 50.0,
          finalPrice: 450.0,
          paymentStatus: 'PAID',
          completionDate: null,
          notes: 'Early bird discount applied',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: enrollment2Id,
          studentId: student2Id,
          courseId: course1Id,
          branchId: branch1Id,
          enrollmentDate: '2024-02-01',
          status: 'ACTIVE',
          originalPrice: 500.0,
          discountPercent: 0,
          discountAmount: 0,
          finalPrice: 500.0,
          paymentStatus: 'PAID',
          completionDate: null,
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: enrollment3Id,
          studentId: student3Id,
          courseId: course3Id,
          branchId: branch2Id,
          enrollmentDate: '2024-01-20',
          status: 'ACTIVE',
          originalPrice: 600.0,
          discountPercent: 15,
          discountAmount: 90.0,
          finalPrice: 510.0,
          paymentStatus: 'PAID',
          completionDate: null,
          notes: 'Sibling discount',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'enrollments.json'),
      JSON.stringify(enrollments, null, 2)
    );
    console.log('✓ Enrollments seeded\n');

    // Seed Employees
    console.log('👨‍🏫 Seeding employees...');
    const employees = {
      employees: [
        {
          id: employee1Id,
          firstName: 'Jane',
          lastName: 'Williams',
          email: 'jane.w@automate-magic.com',
          phone: '+1-555-4001',
          position: 'Lead Instructor',
          department: 'Teaching',
          branchId: branch1Id,
          isGlobal: false,
          salary: 4500.0,
          hireDate: '2023-01-20',
          terminationDate: null,
          isActive: true,
          notes: 'Specialized in advanced robotics',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: employee2Id,
          firstName: 'David',
          lastName: 'Brown',
          email: 'david.b@automate-magic.com',
          phone: '+1-555-5001',
          position: 'Marketing Manager',
          department: 'Marketing',
          branchId: null,
          isGlobal: true,
          salary: 5000.0,
          hireDate: '2023-02-01',
          terminationDate: null,
          isActive: true,
          notes: 'Handles marketing for all branches',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'employees.json'),
      JSON.stringify(employees, null, 2)
    );
    console.log('✓ Employees seeded\n');

    // Seed Revenues
    console.log('💰 Seeding revenues...');
    const revenues = {
      revenues: [
        {
          id: uuid(),
          branchId: branch1Id,
          courseId: course1Id,
          enrollmentId: enrollment1Id,
          studentId: student1Id,
          amount: 450.0,
          description: 'Course enrollment payment - Alice Johnson',
          date: '2024-01-15',
          paymentMethod: 'CREDIT_CARD',
          receiptNumber: 'REC-001',
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: uuid(),
          branchId: branch1Id,
          courseId: course1Id,
          enrollmentId: enrollment2Id,
          studentId: student2Id,
          amount: 500.0,
          description: 'Course enrollment payment - Bob Smith',
          date: '2024-02-01',
          paymentMethod: 'BANK_TRANSFER',
          receiptNumber: 'REC-002',
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: uuid(),
          branchId: branch2Id,
          courseId: course3Id,
          enrollmentId: enrollment3Id,
          studentId: student3Id,
          amount: 510.0,
          description: 'Course enrollment payment - Carol Davis',
          date: '2024-01-20',
          paymentMethod: 'CREDIT_CARD',
          receiptNumber: 'REC-003',
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'revenues.json'),
      JSON.stringify(revenues, null, 2)
    );
    console.log('✓ Revenues seeded\n');

    // Seed Expenses
    console.log('💸 Seeding expenses...');
    const expenses = {
      expenses: [
        // Fixed expenses - Branch 1
        {
          id: uuid(),
          branchId: branch1Id,
          type: 'FIXED',
          category: 'RENT',
          amount: 2000.0,
          description: 'Monthly office rent - Downtown Branch',
          date: '2024-01-01',
          isRecurring: true,
          recurringDay: 1,
          parentExpenseId: null,
          distributionMethod: null,
          vendor: 'ABC Property Management',
          invoiceNumber: 'INV-RENT-001',
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: uuid(),
          branchId: branch1Id,
          type: 'FIXED',
          category: 'UTILITIES',
          amount: 300.0,
          description: 'Monthly utilities - Downtown Branch',
          date: '2024-01-01',
          isRecurring: true,
          recurringDay: 1,
          parentExpenseId: null,
          distributionMethod: null,
          vendor: 'City Utilities',
          invoiceNumber: null,
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        // Fixed expenses - Branch 2
        {
          id: uuid(),
          branchId: branch2Id,
          type: 'FIXED',
          category: 'RENT',
          amount: 2500.0,
          description: 'Monthly office rent - Westside Branch',
          date: '2024-01-01',
          isRecurring: true,
          recurringDay: 1,
          parentExpenseId: null,
          distributionMethod: null,
          vendor: 'XYZ Realty',
          invoiceNumber: 'INV-RENT-002',
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        // Shared expense
        {
          id: uuid(),
          branchId: null,
          type: 'SHARED',
          category: 'MARKETING',
          amount: 3000.0,
          description: 'Company-wide marketing campaign',
          date: '2024-01-10',
          isRecurring: false,
          recurringDay: null,
          parentExpenseId: null,
          distributionMethod: 'EQUAL',
          vendor: 'Digital Marketing Co',
          invoiceNumber: 'INV-MKT-001',
          notes: 'Social media and Google Ads campaign',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        // Variable expense
        {
          id: uuid(),
          branchId: branch1Id,
          type: 'VARIABLE',
          category: 'SUPPLIES',
          amount: 450.0,
          description: 'Robotics kits and components',
          date: '2024-01-15',
          isRecurring: false,
          recurringDay: null,
          parentExpenseId: null,
          distributionMethod: null,
          vendor: 'TechSupply Inc',
          invoiceNumber: 'INV-SUP-001',
          notes: 'Arduino boards and sensors',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(
      join(dataDir, 'expenses.json'),
      JSON.stringify(expenses, null, 2)
    );
    console.log('✓ Expenses seeded\n');

    console.log('🎉 Data seeding completed successfully!\n');
    console.log('📝 Summary:');
    console.log(`   - Users: ${users.users.length}`);
    console.log(`   - Branches: ${branches.branches.length}`);
    console.log(`   - Courses: ${courses.courses.length}`);
    console.log(`   - Students: ${students.students.length}`);
    console.log(`   - Enrollments: ${enrollments.enrollments.length}`);
    console.log(`   - Employees: ${employees.employees.length}`);
    console.log(`   - Revenues: ${revenues.revenues.length}`);
    console.log(`   - Expenses: ${expenses.expenses.length}`);
    console.log('\n🔑 Default Login Credentials:');
    console.log('   Admin:');
    console.log('   - Email: admin@automate-magic.com');
    console.log('   - Password: admin123\n');
    console.log('   Branch Manager:');
    console.log('   - Email: manager@automate-magic.com');
    console.log('   - Password: manager123\n');
    console.log('   Accountant:');
    console.log('   - Email: accountant@automate-magic.com');
    console.log('   - Password: accountant123\n');
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

seedData();
