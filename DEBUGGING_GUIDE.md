# Debugging Guide - Recent Fixes

## Issue 1: Registration API Error (400 Bad Request)

### Problem
Registration endpoint returning generic "Registration failed" message without details.

### Fixed
Updated `aws/lambda/api/src/routes/auth.ts` to log detailed error information and return error message in development mode.

### How to Debug

1. **Check browser console** for the actual error response
2. **Check backend logs** (CloudWatch or local terminal)
3. **Verify request payload** includes all required fields:
   ```json
   {
     "companyName": "Test Company",
     "companyEmail": "company@example.com",
     "firstName": "John",
     "lastName": "Doe",
     "email": "john@example.com",
     "password": "password123",
     "timezone": "Africa/Cairo"
   }
   ```

### Common Causes
- ❌ Missing required fields (companyName, companyEmail, firstName, lastName, email, password)
- ❌ Duplicate email (company or user email already exists)
- ❌ Database connection issue
- ❌ Password too short
- ❌ Invalid email format

### Testing
```bash
# Test registration with curl
curl -X POST https://ezmbtlr966.execute-api.eu-west-1.amazonaws.com/dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Robotics Academy",
    "companyEmail": "academy@test.com",
    "firstName": "John",
    "lastName": "Smith",
    "email": "john.smith@test.com",
    "password": "SecurePass123!",
    "phone": "+1234567890",
    "timezone": "America/New_York"
  }'
```

---

## Issue 2: Filtered Courses Not Working

### Problem
When selecting a branch in the enrollment form, the course dropdown showed no courses even though courses existed for that branch.

### Root Causes
1. **Global courses not included**: Courses with `branchId = null` (global courses available to all branches) were filtered out
2. **Type mismatch**: Form value (string) vs database value (UUID string) comparison issues

### Fixed
Updated `frontend/src/app/features/enrollments/enrollment-form/enrollment-form.component.ts`:

```typescript
filteredCourses = computed(() => {
  const branchId = this.enrollmentForm?.get('branchId')?.value;
  if (!branchId) return [];

  // Include courses that:
  // 1. Belong to the selected branch (branchId matches)
  // 2. Are global courses (branchId is null)
  return this.courses().filter(c => {
    const courseBranchId = c.branchId ? String(c.branchId) : null;
    const selectedBranchId = String(branchId);
    return courseBranchId === selectedBranchId || courseBranchId === null;
  });
});
```

Also updated `shared/interfaces/course.interface.ts` to properly type `branchId` as nullable:
```typescript
branchId: string | null; // Can be null for global courses
```

### How to Test

1. **Create a global course** (branchId = null):
   - Go to Courses → Create New Course
   - Leave branch empty or select "All Branches"
   - Save course

2. **Create a branch-specific course**:
   - Go to Courses → Create New Course
   - Select a specific branch
   - Save course

3. **Test enrollment form**:
   - Go to Enrollments → Create Enrollment
   - Select a branch
   - Course dropdown should now show:
     - ✅ Courses specific to that branch
     - ✅ Global courses (available to all branches)

### Debug Console Logs

Open browser console to see filtering logs:
```
Computing filtered courses for branchId: <selected-branch-id>
All courses available: <total-count>
Filtered courses: <filtered-count> [
  { id: '...', name: 'Course 1', branchId: '...', isGlobal: false },
  { id: '...', name: 'Global Course', branchId: null, isGlobal: true }
]
```

### Verification Checklist

- [ ] Branch dropdown populated with branches
- [ ] Course dropdown disabled when no branch selected
- [ ] Course dropdown shows "No active courses available" if truly no courses
- [ ] Course dropdown shows both branch-specific AND global courses
- [ ] Selecting different branches shows different course lists
- [ ] Global courses appear in ALL branch selections

---

## Rebuild & Deploy

After fixes, rebuild and deploy:

```bash
# Rebuild backend
cd aws/lambda/api
npm run build

# Deploy backend
cd ../../
npm run deploy  # or your CDK deploy command

# Rebuild frontend
cd frontend
npm run build
```

---

## Additional Debugging Tips

### Check Database State

```sql
-- Check if courses exist
SELECT id, name, branch_id, is_active, company_id
FROM courses
WHERE is_active = true;

-- Check if branches exist
SELECT id, name, is_active, company_id
FROM branches
WHERE is_active = true;

-- Check company data
SELECT id, name, subscription_status, is_active
FROM companies;
```

### Network Tab Inspection

1. Open Chrome DevTools → Network tab
2. Filter by "Fetch/XHR"
3. Look for:
   - `/api/auth/register` - Check request payload and response
   - `/api/courses` - Check if courses are being returned
   - `/api/branches` - Check if branches are being returned

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| No courses in dropdown | All courses inactive | Activate courses in DB or UI |
| No courses in dropdown | Wrong company_id filter | Check JWT token has correct companyId |
| 400 on registration | Missing required field | Check all required fields are sent |
| 400 on registration | Duplicate email | Use different email or check DB |
| 401 on API calls | Token expired | Re-login to get new token |
| 403 on branch access | User doesn't have permission | Check user role and branchId |

---

## Need More Help?

If issues persist:

1. **Check browser console** for JavaScript errors
2. **Check network tab** for failed API calls
3. **Check backend logs** (CloudWatch or local terminal)
4. **Verify database state** with SQL queries
5. **Check JWT token payload**:
   ```javascript
   // In browser console
   const token = localStorage.getItem('auth_token');
   const payload = JSON.parse(atob(token.split('.')[1]));
   console.log('Token payload:', payload);
   ```

---

**Last Updated:** February 11, 2026
