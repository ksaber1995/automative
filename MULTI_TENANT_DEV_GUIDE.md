# Multi-Tenant Development Guide

Quick reference for developers working with the multi-tenant architecture.

## Core Concepts

### Tenant Hierarchy

```
Company (Top Level)
  └── Branches
       └── Users
            └── Students, Courses, Enrollments, etc.
```

**Key Rule**: Everything belongs to a company. Company ID must be in every query.

## Backend Development

### Adding a New API Endpoint

Every endpoint must follow this pattern:

```typescript
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

export const myRoutes = {
  list: async ({ query, headers }: {
    query: { branchId?: string };
    headers: { authorization: string };
  }) => {
    // 1. Extract tenant context (throws if invalid)
    const context = await extractTenantContext(headers.authorization);

    // 2. Build query with MANDATORY company_id filter
    let sql = 'SELECT * FROM my_table WHERE company_id = $1';
    const params: any[] = [context.companyId];

    // 3. Optional branch filtering (with permission check)
    if (query.branchId) {
      if (!canAccessBranch(context, query.branchId)) {
        return { status: 403, body: { message: 'Access denied to this branch' } };
      }
      params.push(query.branchId);
      sql += ` AND branch_id = $${params.length}`;
    } else if (context.role !== 'ADMIN' && context.branchId) {
      // Non-admins automatically filtered to their branch
      params.push(context.branchId);
      sql += ` AND branch_id = $${params.length}`;
    }

    const records = await query(sql, params);
    return { status: 200, body: records };
  },

  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    const context = await extractTenantContext(headers.authorization);

    // 4. Validate branch access if branch-specific
    if (body.branchId && !canAccessBranch(context, body.branchId)) {
      return { status: 403, body: { message: 'Access denied to this branch' } };
    }

    // 5. Always include company_id when inserting
    const record = await insert('my_table', {
      company_id: context.companyId,  // MANDATORY
      branch_id: body.branchId,
      // ... other fields
    });

    return { status: 201, body: record };
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    const context = await extractTenantContext(headers.authorization);

    // 6. ALWAYS filter by company_id when fetching by ID
    const record = await queryOne(
      'SELECT * FROM my_table WHERE id = $1 AND company_id = $2',
      [params.id, context.companyId]
    );

    if (!record) {
      return { status: 404, body: { message: 'Not found' } };
    }

    return { status: 200, body: record };
  },

  update: async ({ params, body, headers }: {
    params: { id: string };
    body: any;
    headers: { authorization: string };
  }) => {
    const context = await extractTenantContext(headers.authorization);

    // 7. Verify ownership before update
    const existing = await queryOne(
      'SELECT * FROM my_table WHERE id = $1 AND company_id = $2',
      [params.id, context.companyId]
    );

    if (!existing) {
      return { status: 404, body: { message: 'Not found' } };
    }

    // 8. Validate branch access if changing branch
    if (body.branchId && !canAccessBranch(context, body.branchId)) {
      return { status: 403, body: { message: 'Access denied' } };
    }

    const updated = await update('my_table', params.id, body);
    return { status: 200, body: updated };
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    const context = await extractTenantContext(headers.authorization);

    // 9. Verify ownership before delete
    const existing = await queryOne(
      'SELECT * FROM my_table WHERE id = $1 AND company_id = $2',
      [params.id, context.companyId]
    );

    if (!existing) {
      return { status: 404, body: { message: 'Not found' } };
    }

    await execute('DELETE FROM my_table WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
    return { status: 204 };
  }
};
```

### Tenant Context Interface

```typescript
interface TenantContext {
  userId: string;
  email: string;
  role: 'ADMIN' | 'BRANCH_MANAGER' | 'ACCOUNTANT';
  companyId: string;  // ALWAYS present
  branchId?: string | null;
}
```

### Permission Checks

```typescript
// Check if user can access specific branch
if (!canAccessBranch(context, targetBranchId)) {
  return { status: 403, body: { message: 'Access denied' } };
}

// Role-based checks
if (context.role === 'ADMIN') {
  // Company-wide access
}

if (context.role === 'BRANCH_MANAGER' && context.branchId) {
  // Only their branch
}
```

### Database Queries - Critical Rules

✅ **ALWAYS DO**:
```typescript
// ✅ Filter by company_id
'SELECT * FROM students WHERE company_id = $1'

// ✅ Include company_id in all WHERE clauses
'SELECT * FROM students WHERE id = $1 AND company_id = $2'

// ✅ Include company_id when inserting
await insert('students', {
  company_id: context.companyId,
  // ... other fields
});
```

❌ **NEVER DO**:
```typescript
// ❌ Missing company_id filter
'SELECT * FROM students WHERE id = $1'

// ❌ Inserting without company_id
await insert('students', {
  // Missing company_id!
  first_name: 'John',
});

// ❌ Global queries without company_id
'SELECT * FROM students'
```

### Complex Queries (JOINs)

```typescript
const sql = `
  SELECT
    e.*,
    s.first_name || ' ' || s.last_name as student_name,
    c.name as course_name,
    b.name as branch_name
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  JOIN courses c ON c.id = e.course_id
  JOIN branches b ON b.id = e.branch_id
  WHERE e.company_id = $1           -- Filter main table
    AND s.company_id = $1           -- Filter joined tables too!
    AND c.company_id = $1
    AND b.company_id = $1
`;
```

**Rule**: Filter EVERY table in the JOIN by company_id.

### Aggregate Queries

```typescript
// Company-specific aggregates
const revenue = await queryOne(
  `SELECT COALESCE(SUM(final_price), 0) as total
   FROM enrollments
   WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')`,
  [context.companyId]
);
```

## Frontend Development

### Using RegisterDto (Company Registration)

```typescript
import { RegisterDto } from '@shared/interfaces/user.interface';

const registerData: RegisterDto = {
  // Company information
  companyName: 'Acme Education',
  companyEmail: 'info@acme-edu.com',
  companyCode: 'ACME-001',  // Optional
  industry: 'Education & Training',
  timezone: 'Africa/Cairo',

  // User information (becomes company owner)
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@acme-edu.com',
  password: 'securepassword123',
  phone: '+20 123 456 7890'  // Optional
};

this.authService.register(registerData).subscribe({
  next: (response) => {
    // response.user contains the user with companyId
    // response.company contains the company summary
  }
});
```

### Creating Entities (Always Include companyId)

Frontend services automatically work because:
1. Shared interfaces include `companyId` field
2. Auth interceptor adds JWT token to all requests
3. Backend extracts companyId from JWT token

Example - Creating a student:
```typescript
// The interface requires companyId (TypeScript enforces it)
const student: StudentCreateDto = {
  firstName: 'Jane',
  lastName: 'Smith',
  parentName: 'Parent Smith',
  parentPhone: '123456789',
  branchId: this.selectedBranchId,  // User's branch
  enrollmentDate: '2024-01-01',
  // companyId is automatically handled by backend from JWT
};

this.studentService.create(student).subscribe(...);
```

### Accessing User's Company

```typescript
import { AuthService } from '@core/services/auth.service';

export class MyComponent {
  private authService = inject(AuthService);

  ngOnInit() {
    const user = this.authService.currentUser();

    console.log('User Company ID:', user?.companyId);
    console.log('User Role:', user?.role);  // ADMIN, BRANCH_MANAGER, ACCOUNTANT
    console.log('User Branch:', user?.branchId);
  }
}
```

## Database Schema

### Adding a New Table

All new tables MUST include:

```sql
CREATE TABLE my_new_table (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- MANDATORY: Company foreign key
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Optional: Branch foreign key (if branch-specific)
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,

    -- Your fields here
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Optional: Global resource flag
    is_global BOOLEAN DEFAULT false,

    -- Audit fields
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraints MUST include company_id
    CONSTRAINT my_new_table_company_code_key UNIQUE(company_id, code)
);

-- ALWAYS index company_id
CREATE INDEX idx_my_new_table_company_id ON my_new_table(company_id);

-- Index branch_id if applicable
CREATE INDEX idx_my_new_table_branch_id ON my_new_table(branch_id);
```

### Modifying Existing Tables

If adding a field to existing table:

```sql
-- Add column
ALTER TABLE existing_table ADD COLUMN new_field VARCHAR(100);

-- If it's a unique field, scope it to company
ALTER TABLE existing_table DROP CONSTRAINT IF EXISTS existing_table_new_field_key;
ALTER TABLE existing_table ADD CONSTRAINT existing_table_company_new_field_key
  UNIQUE(company_id, new_field);
```

## Testing Tenant Isolation

### Unit Test Pattern

```typescript
describe('Multi-tenant isolation', () => {
  let companyAToken: string;
  let companyBToken: string;
  let studentAId: string;

  beforeAll(async () => {
    // Register two companies
    const companyA = await registerCompany({
      companyName: 'Company A',
      email: 'admin@companya.com'
    });
    companyAToken = companyA.accessToken;

    const companyB = await registerCompany({
      companyName: 'Company B',
      email: 'admin@companyb.com'
    });
    companyBToken = companyB.accessToken;

    // Create student in Company A
    const studentA = await createStudent(companyAToken, {
      firstName: 'StudentA',
      lastName: 'TestA'
    });
    studentAId = studentA.id;
  });

  it('should not allow Company B to see Company A student', async () => {
    const response = await fetch(`/api/students`, {
      headers: { Authorization: `Bearer ${companyBToken}` }
    });
    const students = await response.json();

    expect(students).toHaveLength(0);
    expect(students.find(s => s.id === studentAId)).toBeUndefined();
  });

  it('should not allow Company B to access Company A student by ID', async () => {
    const response = await fetch(`/api/students/${studentAId}`, {
      headers: { Authorization: `Bearer ${companyBToken}` }
    });

    expect(response.status).toBe(404);
  });

  it('should allow Company A to see their own student', async () => {
    const response = await fetch(`/api/students`, {
      headers: { Authorization: `Bearer ${companyAToken}` }
    });
    const students = await response.json();

    expect(students).toHaveLength(1);
    expect(students[0].id).toBe(studentAId);
  });
});
```

### Manual Testing Checklist

For each new endpoint:

- [ ] Create data in Company A
- [ ] Login as Company B
- [ ] Verify Company B cannot see Company A's data
- [ ] Verify Company B cannot access Company A's data by ID (404)
- [ ] Verify Company B cannot update Company A's data (404)
- [ ] Verify Company B cannot delete Company A's data (404)
- [ ] Login as Company A
- [ ] Verify Company A can see their own data
- [ ] Verify ADMIN can see all branches in company
- [ ] Verify BRANCH_MANAGER can only see their branch

## Common Patterns

### Global vs Branch-Specific Resources

Some resources (courses, products) can be company-wide or branch-specific:

```typescript
// Creating a global course (available to all branches in company)
await insert('courses', {
  company_id: context.companyId,
  branch_id: null,  // null = global
  is_global: true,
  name: 'Math 101',
});

// Creating branch-specific course
await insert('courses', {
  company_id: context.companyId,
  branch_id: specificBranchId,
  is_global: false,
  name: 'Local Art Class',
});

// Query both global and branch-specific
const sql = `
  SELECT * FROM courses
  WHERE company_id = $1
    AND (is_global = true OR branch_id = $2)
`;
```

### Handling Soft Deletes

```typescript
// Soft delete (recommended)
await update('students', studentId, {
  is_active: false,
  updated_at: new Date().toISOString()
});

// Query only active records
const sql = `
  SELECT * FROM students
  WHERE company_id = $1 AND is_active = true
`;

// Hard delete (use with caution)
await execute(
  'DELETE FROM students WHERE id = $1 AND company_id = $2',
  [studentId, context.companyId]
);
```

## Troubleshooting

### "Access denied" errors

1. Check if JWT token includes companyId:
```typescript
const token = localStorage.getItem('auth_token');
const payload = JSON.parse(atob(token.split('.')[1]));
console.log('Company ID:', payload.companyId);
```

2. Check if user has permission for the branch:
```typescript
// BRANCH_MANAGER can only access their own branch
if (context.role === 'BRANCH_MANAGER' && context.branchId !== targetBranchId) {
  // Access denied
}
```

### Data not showing up

1. Verify company_id is in the query:
```sql
-- Check query includes company_id filter
WHERE company_id = $1
```

2. Check if user is in correct company:
```typescript
console.log('User company:', user.companyId);
console.log('Resource company:', resource.companyId);
```

3. Check if resource is active:
```sql
WHERE is_active = true
```

### Can see other company's data (DATA LEAK!)

🚨 **CRITICAL SECURITY ISSUE**

1. Check if query is missing company_id filter
2. Check if JWT token is being validated properly
3. Verify extractTenantContext is called at start of endpoint
4. Check database query includes company_id in WHERE clause
5. Run test-multi-tenant.sh to verify isolation

## Quick Reference Commands

```bash
# Run multi-tenant isolation tests
chmod +x test-multi-tenant.sh
API_URL=http://localhost:3000 ./test-multi-tenant.sh

# Check database for missing company_id
psql -d automate_magic -c "
  SELECT 'students' as table_name, COUNT(*) as null_count
  FROM students WHERE company_id IS NULL
  UNION ALL
  SELECT 'courses', COUNT(*) FROM courses WHERE company_id IS NULL;
"

# View JWT token payload
echo "TOKEN_HERE" | cut -d '.' -f 2 | base64 -d | jq

# Check user's company and role
psql -d automate_magic -c "
  SELECT u.email, u.role, u.company_id, c.name as company_name
  FROM users u
  JOIN companies c ON c.id = u.company_id
  WHERE u.email = 'user@example.com';
"
```

## Best Practices

1. ✅ **Always** extract tenant context at the start of every endpoint
2. ✅ **Always** include `company_id = $1` in WHERE clauses
3. ✅ **Always** verify ownership before updates/deletes
4. ✅ **Always** validate branch access with `canAccessBranch()`
5. ✅ **Never** trust client-provided company_id (always use JWT)
6. ✅ **Never** write global queries without company_id
7. ✅ **Never** skip tenant context extraction
8. ✅ **Test** every endpoint with multiple companies
9. ✅ **Index** company_id on all tables
10. ✅ **Document** any company-wide resources (is_global flag)

## Questions?

Refer to:
- `DEPLOYMENT_GUIDE.md` - Full deployment instructions
- `MULTI_TENANT_TRANSFORMATION.md` - Implementation summary
- `test-multi-tenant.sh` - Testing examples
- `aws/lambda/api/src/middleware/tenant-isolation.ts` - Middleware implementation
- `aws/lambda/api/src/routes/*.ts` - Example route implementations
