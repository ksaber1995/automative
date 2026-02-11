# Multi-Tenant SaaS Deployment Guide

## Overview
This guide covers the deployment of the multi-tenant transformation for the Automate Magic application. This is a **BREAKING CHANGE** that will require all users to re-login.

## ⚠️ Critical Warnings

1. **All existing JWT tokens will become invalid** - Users must re-login
2. **Database schema changes** - Requires 5-15 minutes of downtime
3. **Breaking API changes** - Frontend and backend must be deployed simultaneously
4. **Data migration** - Existing data will be migrated to a default "Legacy Company"
5. **Irreversible changes** - Ensure you have complete database backups

## Pre-Deployment Checklist

### 1. Backup Everything
- [ ] Full database backup (`pg_dump` or AWS RDS snapshot)
- [ ] Current Lambda function code backup
- [ ] Frontend build backup
- [ ] Environment variables documented

### 2. Verify Code Changes
- [ ] All 4 migration SQL files exist in `aws/sql/migrations/`
- [ ] JWT utility updated with companyId
- [ ] Tenant isolation middleware created
- [ ] All 17 route files updated
- [ ] API contract updated
- [ ] Shared interfaces updated

### 3. Test Environment
- [ ] Deploy to staging/test environment first
- [ ] Run all migrations in test environment
- [ ] Verify data integrity after migration
- [ ] Test all API endpoints
- [ ] Test frontend flows

## Deployment Steps

### Phase 1: Database Migration (REQUIRES DOWNTIME)

**Estimated Time:** 5-15 minutes
**Downtime Required:** Yes

1. **Create Database Backup**
   ```bash
   # PostgreSQL
   pg_dump -h <host> -U <user> -d <database> > backup_$(date +%Y%m%d_%H%M%S).sql

   # AWS RDS - Create snapshot via console or CLI
   aws rds create-db-snapshot \
     --db-snapshot-identifier automate-magic-pre-migration-$(date +%Y%m%d) \
     --db-instance-identifier <your-instance>
   ```

2. **Put Application in Maintenance Mode**
   - Display maintenance page to users
   - Disable API endpoints temporarily
   - Stop all background jobs

3. **Run Migration 001: Create Companies Table**
   ```bash
   psql -h <host> -U <user> -d <database> -f aws/sql/migrations/001_create_companies_table.sql
   ```

4. **Run Migration 002: Add company_id Columns**
   ```bash
   psql -h <host> -U <user> -d <database> -f aws/sql/migrations/002_add_company_id_to_all_tables.sql
   ```

5. **Run Migration 003: Migrate Existing Data**
   ```bash
   psql -h <host> -U <user> -d <database> -f aws/sql/migrations/003_migrate_existing_data.sql
   ```

6. **Run Migration 004: Enforce NOT NULL Constraints**
   ```bash
   psql -h <host> -U <user> -d <database> -f aws/sql/migrations/004_enforce_company_id_constraints.sql
   ```

7. **Verify Migration Success**
   ```sql
   -- Check companies table exists and has data
   SELECT COUNT(*) FROM companies;

   -- Verify all tables have company_id
   SELECT
     table_name,
     COUNT(*) FILTER (WHERE company_id IS NULL) as null_count
   FROM (
     SELECT 'branches' as table_name, company_id FROM branches
     UNION ALL
     SELECT 'users', company_id FROM users
     UNION ALL
     SELECT 'courses', company_id FROM courses
     -- Add all other tables...
   ) subquery
   GROUP BY table_name;
   -- Should return 0 null_count for all tables

   -- Check unique constraints
   SELECT conname, conrelid::regclass
   FROM pg_constraint
   WHERE conname LIKE '%company_id%';
   ```

### Phase 2: Backend Deployment

1. **Update Environment Variables** (if needed)
   - Verify JWT_SECRET is secure
   - Check database connection strings

2. **Deploy Lambda Functions** (AWS SAM/Serverless)
   ```bash
   cd aws/lambda/api
   npm install
   npm run build

   # Deploy with SAM
   sam build
   sam deploy --guided

   # OR with Serverless Framework
   serverless deploy --stage production
   ```

3. **Verify Backend Deployment**
   ```bash
   # Test health endpoint
   curl https://your-api.com/health

   # Test new registration endpoint (should create company)
   curl -X POST https://your-api.com/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "companyName": "Test Company",
       "companyEmail": "test@company.com",
       "firstName": "John",
       "lastName": "Doe",
       "email": "john@test.com",
       "password": "testpassword123"
     }'
   ```

### Phase 3: Frontend Deployment

1. **Update Frontend Environment Variables**
   ```bash
   # .env.production
   VITE_API_URL=https://your-api.com
   ```

2. **Build Frontend**
   ```bash
   cd frontend
   npm install
   npm run build
   ```

3. **Deploy Frontend** (S3 + CloudFront or Vercel/Netlify)
   ```bash
   # AWS S3 + CloudFront
   aws s3 sync dist/ s3://your-bucket-name --delete
   aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"

   # OR Vercel
   vercel deploy --prod
   ```

### Phase 4: Post-Deployment Verification

1. **Enable Application**
   - Remove maintenance mode
   - Enable API endpoints
   - Restart background jobs

2. **Notify Users**
   Send notification to all users:
   ```
   Subject: Important: System Upgrade - Please Re-Login

   We've upgraded to a multi-tenant architecture to better serve you.

   Action Required:
   - Please log out and log back in
   - Your existing credentials will work
   - All your data has been preserved

   What's New:
   - Improved security with company-level data isolation
   - Better performance
   - Foundation for new features
   ```

## Verification Checklist

### Database Verification

- [ ] All tables have company_id column with NOT NULL constraint
- [ ] Companies table exists with at least one company
- [ ] All existing data migrated to default company
- [ ] No NULL company_id values in any table
- [ ] Foreign key constraints working
- [ ] Unique constraints updated to include company_id

```sql
-- Verification queries
SELECT * FROM companies;
SELECT COUNT(*) as branch_count FROM branches WHERE company_id IS NULL; -- Should be 0
SELECT COUNT(*) as user_count FROM users WHERE company_id IS NULL; -- Should be 0
-- Repeat for all tables
```

### API Verification

Test all major endpoints:

- [ ] **Auth**
  - [ ] Register new company (POST /api/auth/register)
  - [ ] Login returns JWT with companyId (POST /api/auth/login)
  - [ ] Profile includes companyId (GET /api/auth/profile)
  - [ ] Old tokens rejected (401 error)

- [ ] **Data Isolation**
  - [ ] Create two test companies
  - [ ] Add data to Company A
  - [ ] Login as Company B user
  - [ ] Verify Company B cannot see Company A's data

- [ ] **CRUD Operations**
  - [ ] Students: Create, List, Get, Update, Delete
  - [ ] Courses: Create, List, Get, Update, Delete
  - [ ] Branches: Create, List, Get, Update, Delete
  - [ ] Enrollments: Create, List, Get, Update, Delete

- [ ] **Complex Queries**
  - [ ] Revenue summary filtered by company
  - [ ] Analytics dashboard company-scoped
  - [ ] Reports generated per company
  - [ ] Cash state calculated per company

### Frontend Verification

- [ ] **Registration Flow**
  - [ ] New registration form includes company fields
  - [ ] Registration creates company + branch + user
  - [ ] Success message shows company created

- [ ] **Login Flow**
  - [ ] Login successful
  - [ ] CompanyId stored in auth state
  - [ ] All API calls include Authorization header

- [ ] **Data Display**
  - [ ] All lists show only company-specific data
  - [ ] No cross-company data leakage
  - [ ] Branch filtering works correctly

- [ ] **Permissions**
  - [ ] ADMIN sees all branches in company
  - [ ] BRANCH_MANAGER sees only their branch
  - [ ] Branch access control enforced

### Multi-Tenant Isolation Testing

**Test Script:**
```bash
# 1. Register Company A
COMPANY_A_TOKEN=$(curl -s -X POST https://your-api.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Company A",
    "companyEmail": "companya@test.com",
    "firstName": "Alice",
    "lastName": "Anderson",
    "email": "alice@companya.com",
    "password": "password123"
  }' | jq -r '.accessToken')

# 2. Create student in Company A
STUDENT_A_ID=$(curl -s -X POST https://your-api.com/api/students \
  -H "Authorization: Bearer $COMPANY_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "StudentA",
    "lastName": "Test",
    "parentName": "Parent A",
    "parentPhone": "1234567890",
    "branchId": "branch-id-from-company-a",
    "enrollmentDate": "2024-01-01"
  }' | jq -r '.id')

# 3. Register Company B
COMPANY_B_TOKEN=$(curl -s -X POST https://your-api.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Company B",
    "companyEmail": "companyb@test.com",
    "firstName": "Bob",
    "lastName": "Brown",
    "email": "bob@companyb.com",
    "password": "password123"
  }' | jq -r '.accessToken')

# 4. Try to access Company A's student from Company B (should fail)
curl -X GET "https://your-api.com/api/students/$STUDENT_A_ID" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN"
# Expected: 404 Not Found

# 5. List students as Company B (should be empty)
curl -X GET "https://your-api.com/api/students" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN"
# Expected: Empty array []

# 6. List students as Company A (should include StudentA)
curl -X GET "https://your-api.com/api/students" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN"
# Expected: Array with StudentA
```

## Rollback Procedure

If critical issues are discovered:

### Immediate Rollback (< 1 hour after deployment)

1. **Restore Database Backup**
   ```bash
   # PostgreSQL
   psql -h <host> -U <user> -d <database> < backup_YYYYMMDD_HHMMSS.sql

   # AWS RDS - Restore from snapshot
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier automate-magic-restored \
     --db-snapshot-identifier automate-magic-pre-migration-YYYYMMDD
   ```

2. **Revert Lambda Functions**
   ```bash
   # Deploy previous version
   aws lambda update-function-code \
     --function-name your-function-name \
     --s3-bucket your-backup-bucket \
     --s3-key previous-version.zip
   ```

3. **Revert Frontend**
   ```bash
   # Deploy previous frontend build
   aws s3 sync s3://backup-bucket/previous-build/ s3://your-bucket-name/
   aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
   ```

### Partial Rollback (After users have started using new system)

**Cannot fully rollback** - New companies will have been created. Options:
1. Fix the issue and redeploy
2. Keep legacy company operational while fixing issues
3. Manual data migration if needed

## Post-Deployment Monitoring

### Metrics to Watch (First 24 Hours)

- [ ] API error rate (should remain stable)
- [ ] Authentication success rate
- [ ] Database query performance
- [ ] Lambda cold starts
- [ ] Frontend load times

### CloudWatch Alarms

```bash
# Set up alarms for:
- API 5XX errors > threshold
- Lambda function errors > threshold
- Database CPU utilization > 80%
- Database connections > 90% of max
```

### Log Monitoring

```bash
# Check logs for errors
aws logs tail /aws/lambda/your-function-name --follow --filter-pattern "ERROR"

# Look for authentication errors
aws logs tail /aws/lambda/your-function-name --follow --filter-pattern "No authentication token"

# Look for tenant isolation errors
aws logs tail /aws/lambda/your-function-name --follow --filter-pattern "Access denied to this"
```

## Troubleshooting

### Issue: Users Can't Login

**Symptoms:** 401 errors on login

**Causes:**
1. JWT secret changed
2. Database migration incomplete
3. companyId not in JWT payload

**Fix:**
```bash
# Check user's company_id exists
psql -c "SELECT id, email, company_id FROM users WHERE email='user@example.com';"

# Verify companies table
psql -c "SELECT id, name FROM companies;"

# Test login endpoint directly
curl -X POST https://your-api.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}' \
  -v
```

### Issue: Users See Other Company's Data

**Symptoms:** Data leakage between companies

**Causes:**
1. Missing company_id filter in query
2. Route not updated with tenant isolation
3. Frontend not sending auth token

**Fix:**
1. Check affected route file - ensure `WHERE company_id = $1`
2. Verify `extractTenantContext` is called
3. Check browser network tab for Authorization header

### Issue: Old Tokens Still Work

**Symptoms:** Users not forced to re-login

**Causes:**
1. JWT verification not checking for companyId
2. Token expiry too long

**Fix:**
```typescript
// Verify jwt.ts has this check
if (!decoded.companyId) {
  throw new Error('Invalid token: missing company context');
}
```

### Issue: Registration Creates User but No Company

**Symptoms:** 500 error on registration

**Causes:**
1. Transaction failed midway
2. companies table missing
3. Foreign key constraint issue

**Fix:**
```bash
# Check if companies table exists
psql -c "\d companies"

# Check if transaction rolled back
psql -c "SELECT COUNT(*) FROM companies;"
psql -c "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '1 hour';"
# Should be equal
```

## Success Criteria

Deployment is successful when:

- [x] All database migrations completed without errors
- [x] All existing users can login (may need to re-enter password)
- [x] New companies can register successfully
- [x] Data isolation verified between companies
- [x] No 401/403 errors for legitimate requests
- [x] No cross-company data leakage
- [x] All reports and analytics company-scoped
- [x] Performance metrics stable or improved
- [x] Error rates normal
- [x] User complaints minimal

## Support Response Templates

### User Can't Login
```
Your account was migrated to our new multi-tenant system. Please:
1. Clear your browser cache
2. Use "Forgot Password" to reset (if needed)
3. Login with your existing email

Your data is safe and preserved.
```

### User Reports Missing Data
```
Please verify:
1. You're logged into the correct company account
2. Check the branch filter (top right)
3. Confirm the date range filter

If issue persists, contact support with:
- Your email address
- What data is missing
- Screenshot if possible
```

## Communication Plan

### T-7 Days (One Week Before)
- Send email to all users announcing upgrade
- List benefits and what to expect
- Mention required re-login

### T-1 Day (Day Before)
- Reminder email about maintenance window
- Exact time and duration
- What users should do

### T-0 (Deployment Day)
- Status page showing "Maintenance in Progress"
- Twitter/social media updates
- Email when complete

### T+1 Day (Day After)
- "Upgrade Complete" announcement
- Instructions for any issues
- Support contact info

## Next Steps After Successful Deployment

1. **Monitor for 1 Week**
   - Daily checks of error rates
   - User feedback review
   - Performance metrics

2. **Add Company Management Features**
   - Company settings page
   - Subscription management
   - User invitation system
   - Branch creation UI

3. **Implement Subscription Limits**
   - Enforce maxBranches limit
   - Enforce maxUsers limit
   - Subscription billing integration

4. **Add Company Admin Features**
   - User management by company admin
   - Company profile editing
   - Billing and payment history

5. **Analytics and Reporting**
   - Company-level usage analytics
   - Per-company billing reports
   - Growth metrics by company

## Conclusion

This is a major architectural change that transforms the application into a true multi-tenant SaaS. Take time to test thoroughly in staging before production deployment.

**Remember:**
- Backups are your safety net
- Test in staging first
- Have a rollback plan ready
- Monitor closely for 24-48 hours post-deployment
- Communicate clearly with users

Good luck with the deployment! 🚀
