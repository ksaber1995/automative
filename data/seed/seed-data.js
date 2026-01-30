const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

const dataDir = path.join(__dirname, '..');

// Helper to generate random date in range
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString().split('T')[0];
}

// Helper to generate date X months ago
function monthsAgo(months, day = 1) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  date.setDate(day);
  return date.toISOString().split('T')[0];
}

async function seedData() {
  console.log('🌱 Starting comprehensive data seeding for last 2 years...\n');

  try {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const today = new Date();

    // Generate IDs
    const adminId = uuid();
    const manager1Id = uuid();
    const manager2Id = uuid();
    const manager3Id = uuid();
    const accountantId = uuid();

    const branch1Id = uuid();
    const branch2Id = uuid();
    const branch3Id = uuid();
    const branch4Id = uuid();

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
          createdAt: monthsAgo(24),
          updatedAt: new Date().toISOString(),
        },
        {
          id: manager1Id,
          email: 'john.manager@automate-magic.com',
          password: await bcrypt.hash('manager123', 10),
          firstName: 'John',
          lastName: 'Smith',
          role: 'BRANCH_MANAGER',
          branchId: branch1Id,
          isActive: true,
          createdAt: monthsAgo(24),
          updatedAt: new Date().toISOString(),
        },
        {
          id: manager2Id,
          email: 'sarah.manager@automate-magic.com',
          password: await bcrypt.hash('manager123', 10),
          firstName: 'Sarah',
          lastName: 'Johnson',
          role: 'BRANCH_MANAGER',
          branchId: branch2Id,
          isActive: true,
          createdAt: monthsAgo(18),
          updatedAt: new Date().toISOString(),
        },
        {
          id: manager3Id,
          email: 'mike.manager@automate-magic.com',
          password: await bcrypt.hash('manager123', 10),
          firstName: 'Mike',
          lastName: 'Davis',
          role: 'BRANCH_MANAGER',
          branchId: branch3Id,
          isActive: true,
          createdAt: monthsAgo(12),
          updatedAt: new Date().toISOString(),
        },
        {
          id: accountantId,
          email: 'accountant@automate-magic.com',
          password: await bcrypt.hash('accountant123', 10),
          firstName: 'Emily',
          lastName: 'Chen',
          role: 'ACCOUNTANT',
          branchId: null,
          isActive: true,
          createdAt: monthsAgo(24),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
    console.log('✓ Users seeded\n');

    // Seed Branches
    console.log('🏢 Seeding branches...');
    const branches = {
      branches: [
        {
          id: branch1Id,
          name: 'Downtown Manhattan',
          code: 'NYC-DT',
          address: '123 Broadway',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          phone: '+1-212-555-0100',
          email: 'downtown@automate-magic.com',
          managerId: manager1Id,
          isActive: true,
          openingDate: monthsAgo(24),
          createdAt: monthsAgo(24),
          updatedAt: new Date().toISOString(),
        },
        {
          id: branch2Id,
          name: 'Los Angeles West',
          code: 'LA-WEST',
          address: '456 Sunset Blvd',
          city: 'Los Angeles',
          state: 'CA',
          zipCode: '90001',
          phone: '+1-310-555-0200',
          email: 'lawest@automate-magic.com',
          managerId: manager2Id,
          isActive: true,
          openingDate: monthsAgo(18),
          createdAt: monthsAgo(18),
          updatedAt: new Date().toISOString(),
        },
        {
          id: branch3Id,
          name: 'Chicago Loop',
          code: 'CHI-LP',
          address: '789 Michigan Ave',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          phone: '+1-312-555-0300',
          email: 'chicago@automate-magic.com',
          managerId: manager3Id,
          isActive: true,
          openingDate: monthsAgo(12),
          createdAt: monthsAgo(12),
          updatedAt: new Date().toISOString(),
        },
        {
          id: branch4Id,
          name: 'Austin Tech District',
          code: 'AUS-TD',
          address: '321 Congress Ave',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          phone: '+1-512-555-0400',
          email: 'austin@automate-magic.com',
          managerId: null,
          isActive: false,
          openingDate: monthsAgo(6),
          createdAt: monthsAgo(6),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(path.join(dataDir, 'branches.json'), JSON.stringify(branches, null, 2));
    console.log('✓ Branches seeded\n');

    // Seed Courses
    console.log('📚 Seeding courses...');
    const courseTemplates = [
      { name: 'Introduction to Robotics', code: 'ROB-101', price: 499, duration: '8 weeks', level: 'Beginner' },
      { name: 'Arduino Programming', code: 'ARD-101', price: 549, duration: '6 weeks', level: 'Beginner' },
      { name: 'Robot Building Basics', code: 'ROB-102', price: 599, duration: '10 weeks', level: 'Beginner' },
      { name: 'Advanced Robotics', code: 'ROB-201', price: 749, duration: '12 weeks', level: 'Advanced' },
      { name: 'AI & Machine Learning for Robots', code: 'AI-201', price: 899, duration: '12 weeks', level: 'Advanced' },
      { name: 'Autonomous Systems', code: 'AUTO-301', price: 999, duration: '14 weeks', level: 'Expert' },
      { name: 'Python for Robotics', code: 'PY-101', price: 649, duration: '8 weeks', level: 'Intermediate' },
      { name: 'Sensor Integration', code: 'SEN-201', price: 699, duration: '8 weeks', level: 'Intermediate' },
      { name: 'Robot Vision Systems', code: 'VIS-301', price: 849, duration: '10 weeks', level: 'Advanced' },
      { name: 'Competition Robotics', code: 'COMP-401', price: 1099, duration: '16 weeks', level: 'Expert' },
    ];

    const courses = [];
    const activeBranches = [branch1Id, branch2Id, branch3Id];

    courseTemplates.forEach((template) => {
      activeBranches.forEach(branchId => {
        courses.push({
          id: uuid(),
          ...template,
          description: `Learn ${template.name.toLowerCase()} with hands-on projects and expert instructors.`,
          branchId,
          maxStudents: 12 + Math.floor(Math.random() * 8),
          isActive: Math.random() > 0.1,
          createdAt: monthsAgo(Math.floor(Math.random() * 20) + 4),
          updatedAt: new Date().toISOString(),
        });
      });
    });

    await fs.writeFile(path.join(dataDir, 'courses.json'), JSON.stringify({ courses }, null, 2));
    console.log(`✓ ${courses.length} Courses seeded\n`);

    // Seed Students
    console.log('👦 Seeding students...');
    const firstNames = ['Alex', 'Emma', 'Noah', 'Olivia', 'Liam', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella',
      'Lucas', 'Mia', 'Oliver', 'Charlotte', 'Aiden', 'Amelia', 'Elijah', 'Harper', 'James', 'Evelyn',
      'Benjamin', 'Abigail', 'William', 'Emily', 'Daniel', 'Elizabeth', 'Matthew', 'Sofia', 'Henry', 'Avery',
      'Ryan', 'Ella', 'Nathan', 'Madison', 'Jack', 'Scarlett', 'Samuel', 'Victoria', 'Dylan', 'Aria',
      'Logan', 'Grace', 'Caleb', 'Chloe', 'Owen', 'Camila', 'Wyatt', 'Penelope', 'Gabriel', 'Riley'];

    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
      'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
      'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
      'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'];

    const students = [];
    for (let i = 0; i < 200; i++) {
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const branchId = activeBranches[Math.floor(Math.random() * activeBranches.length)];
      const enrollmentDate = randomDate(twoYearsAgo, today);

      students.push({
        id: uuid(),
        firstName,
        lastName,
        dateOfBirth: randomDate(new Date('2008-01-01'), new Date('2016-12-31')),
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
        phone: `+1-555-${String(1000 + i).padStart(4, '0')}`,
        parentName: `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastName}`,
        parentPhone: `+1-555-${String(5000 + i).padStart(4, '0')}`,
        parentEmail: `parent${i}@example.com`,
        address: `${100 + i} Main St, City, State ${10000 + i}`,
        branchId,
        isActive: Math.random() > 0.1,
        enrollmentDate,
        notes: Math.random() > 0.7 ? 'Very enthusiastic about robotics' : null,
        createdAt: enrollmentDate,
        updatedAt: new Date().toISOString(),
      });
    }

    await fs.writeFile(path.join(dataDir, 'students.json'), JSON.stringify({ students }, null, 2));
    console.log(`✓ ${students.length} Students seeded\n`);

    // Seed Enrollments & Revenues
    console.log('📝 Seeding enrollments and revenues...');
    const enrollments = [];
    const revenues = [];

    students.forEach((student, idx) => {
      const studentCourses = courses.filter(c => c.branchId === student.branchId && c.isActive);
      const numEnrollments = Math.floor(Math.random() * 3) + 1;

      for (let i = 0; i < numEnrollments && i < studentCourses.length; i++) {
        const course = studentCourses[Math.floor(Math.random() * studentCourses.length)];
        const enrollmentDate = randomDate(new Date(student.enrollmentDate), today);
        const discountPercent = Math.random() > 0.7 ? [5, 10, 15, 20][Math.floor(Math.random() * 4)] : 0;
        const discountAmount = (course.price * discountPercent) / 100;
        const finalPrice = course.price - discountAmount;
        const enrollmentId = uuid();

        enrollments.push({
          id: enrollmentId,
          studentId: student.id,
          courseId: course.id,
          branchId: course.branchId,
          enrollmentDate,
          status: Math.random() > 0.8 ? 'COMPLETED' : 'ACTIVE',
          originalPrice: course.price,
          discountPercent,
          discountAmount,
          finalPrice,
          paymentStatus: 'PAID',
          completionDate: Math.random() > 0.8 ? randomDate(new Date(enrollmentDate), today) : null,
          notes: discountPercent > 0 ? `${discountPercent}% discount applied` : null,
          createdAt: enrollmentDate,
          updatedAt: new Date().toISOString(),
        });

        revenues.push({
          id: uuid(),
          branchId: course.branchId,
          courseId: course.id,
          enrollmentId,
          studentId: student.id,
          amount: finalPrice,
          description: `Course enrollment - ${student.firstName} ${student.lastName}`,
          date: enrollmentDate,
          paymentMethod: ['CREDIT_CARD', 'BANK_TRANSFER', 'CASH', 'CHECK'][Math.floor(Math.random() * 4)],
          receiptNumber: `REC-${String(idx * 10 + i).padStart(6, '0')}`,
          notes: null,
          createdAt: enrollmentDate,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    await fs.writeFile(path.join(dataDir, 'enrollments.json'), JSON.stringify({ enrollments }, null, 2));
    await fs.writeFile(path.join(dataDir, 'revenues.json'), JSON.stringify({ revenues }, null, 2));
    console.log(`✓ ${enrollments.length} Enrollments seeded`);
    console.log(`✓ ${revenues.length} Revenues seeded\n`);

    // Seed Employees
    console.log('👨‍🏫 Seeding employees...');
    const positions = [
      { title: 'Lead Instructor', dept: 'Teaching', salary: 4500, isGlobal: false },
      { title: 'Junior Instructor', dept: 'Teaching', salary: 3200, isGlobal: false },
      { title: 'Lab Assistant', dept: 'Teaching', salary: 2800, isGlobal: false },
      { title: 'Marketing Manager', dept: 'Marketing', salary: 5000, isGlobal: true },
      { title: 'Operations Manager', dept: 'Operations', salary: 5500, isGlobal: true },
      { title: 'Receptionist', dept: 'Admin', salary: 2500, isGlobal: false },
      { title: 'IT Support', dept: 'IT', salary: 4000, isGlobal: true },
    ];

    const employees = [];
    activeBranches.forEach((branchId, branchIdx) => {
      positions.forEach((pos) => {
        if (!pos.isGlobal || branchIdx === 0) {
          const hireDate = monthsAgo(Math.floor(Math.random() * 20) + 4);
          employees.push({
            id: uuid(),
            firstName: firstNames[Math.floor(Math.random() * firstNames.length)],
            lastName: lastNames[Math.floor(Math.random() * lastNames.length)],
            email: `employee${branchIdx}${employees.length}@automate-magic.com`,
            phone: `+1-555-${String(8000 + employees.length).padStart(4, '0')}`,
            position: pos.title,
            department: pos.dept,
            branchId: pos.isGlobal ? null : branchId,
            isGlobal: pos.isGlobal,
            salary: pos.salary,
            hireDate,
            terminationDate: null,
            isActive: true,
            notes: null,
            createdAt: hireDate,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    });

    await fs.writeFile(path.join(dataDir, 'employees.json'), JSON.stringify({ employees }, null, 2));
    console.log(`✓ ${employees.length} Employees seeded\n`);

    // Seed Expenses
    console.log('💸 Seeding expenses (24 months)...');
    const expenses = [];
    const recurringExpenseTemplates = [];

    activeBranches.forEach((branchId, idx) => {
      const rentAmount = [2000, 2500, 1800][idx];
      const utilitiesAmount = [300, 350, 280][idx];

      recurringExpenseTemplates.push({
        id: uuid(),
        branchId,
        type: 'FIXED',
        category: 'RENT',
        amount: rentAmount,
        description: `Monthly office rent - Branch ${idx + 1}`,
        date: monthsAgo(24, 1),
        isRecurring: true,
        recurringDay: 1,
        parentExpenseId: null,
        distributionMethod: null,
        vendor: 'Property Management LLC',
        invoiceNumber: `RENT-B${idx + 1}`,
        notes: 'Recurring monthly expense',
        createdAt: monthsAgo(24),
        updatedAt: new Date().toISOString(),
      });

      recurringExpenseTemplates.push({
        id: uuid(),
        branchId,
        type: 'FIXED',
        category: 'UTILITIES',
        amount: utilitiesAmount,
        description: `Monthly utilities - Branch ${idx + 1}`,
        date: monthsAgo(24, 1),
        isRecurring: true,
        recurringDay: 1,
        parentExpenseId: null,
        distributionMethod: null,
        vendor: 'City Utilities',
        invoiceNumber: `UTIL-B${idx + 1}`,
        notes: 'Recurring monthly expense',
        createdAt: monthsAgo(24),
        updatedAt: new Date().toISOString(),
      });
    });

    expenses.push(...recurringExpenseTemplates);

    for (let month = 0; month < 24; month++) {
      recurringExpenseTemplates.forEach(template => {
        expenses.push({
          id: uuid(),
          branchId: template.branchId,
          type: template.type,
          category: template.category,
          amount: template.amount,
          description: template.description,
          date: monthsAgo(month, 1),
          isRecurring: false,
          recurringDay: null,
          parentExpenseId: template.id,
          distributionMethod: null,
          vendor: template.vendor,
          invoiceNumber: `${template.invoiceNumber}-${monthsAgo(month, 1).substring(0, 7)}`,
          notes: `Auto-generated from recurring expense`,
          createdAt: monthsAgo(month, 1),
          updatedAt: new Date().toISOString(),
        });
      });

      activeBranches.forEach((branchId) => {
        const suppliesCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < suppliesCount; i++) {
          expenses.push({
            id: uuid(),
            branchId,
            type: 'VARIABLE',
            category: 'SUPPLIES',
            amount: Math.floor(Math.random() * 500) + 200,
            description: 'Robot parts and supplies',
            date: monthsAgo(month, Math.floor(Math.random() * 28) + 1),
            isRecurring: false,
            recurringDay: null,
            parentExpenseId: null,
            distributionMethod: null,
            vendor: 'TechSupply Inc',
            invoiceNumber: `SUP-${uuid().substring(0, 8)}`,
            notes: null,
            createdAt: monthsAgo(month),
            updatedAt: new Date().toISOString(),
          });
        }

        if (month % 3 === 0) {
          expenses.push({
            id: uuid(),
            branchId,
            type: 'VARIABLE',
            category: 'MAINTENANCE',
            amount: Math.floor(Math.random() * 800) + 400,
            description: 'Equipment maintenance',
            date: monthsAgo(month, 15),
            isRecurring: false,
            recurringDay: null,
            parentExpenseId: null,
            distributionMethod: null,
            vendor: 'Tech Maintenance Co',
            invoiceNumber: `MAINT-${uuid().substring(0, 8)}`,
            notes: 'Quarterly maintenance',
            createdAt: monthsAgo(month),
            updatedAt: new Date().toISOString(),
          });
        }
      });

      if (month % 2 === 0) {
        expenses.push({
          id: uuid(),
          branchId: null,
          type: 'SHARED',
          category: 'MARKETING',
          amount: Math.floor(Math.random() * 2000) + 2000,
          description: 'Company-wide marketing campaign',
          date: monthsAgo(month, 10),
          isRecurring: false,
          recurringDay: null,
          parentExpenseId: null,
          distributionMethod: 'PROPORTIONAL',
          vendor: 'Digital Marketing Agency',
          invoiceNumber: `MKT-${uuid().substring(0, 8)}`,
          notes: 'Distributed across all branches',
          createdAt: monthsAgo(month),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await fs.writeFile(path.join(dataDir, 'expenses.json'), JSON.stringify({ expenses }, null, 2));
    console.log(`✓ ${expenses.length} Expenses seeded\n`);

    console.log('🎉 Data seeding completed successfully!\n');
    console.log('📝 Summary:');
    console.log(`   - Users: ${users.users.length}`);
    console.log(`   - Branches: ${branches.branches.length}`);
    console.log(`   - Courses: ${courses.length}`);
    console.log(`   - Students: ${students.length}`);
    console.log(`   - Enrollments: ${enrollments.length}`);
    console.log(`   - Employees: ${employees.length}`);
    console.log(`   - Revenues: ${revenues.length}`);
    console.log(`   - Expenses: ${expenses.length}`);
    console.log('\n🔑 Default Login Credentials:');
    console.log('   Admin: admin@automate-magic.com / admin123\n');
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

seedData();
