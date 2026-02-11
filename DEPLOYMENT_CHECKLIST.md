# Multi-Tenant Deployment Checklist

Quick reference for deployment day.

## Pre-Deployment (T-1 Day)

- [ ] Full database backup completed
- [ ] Lambda function code backup saved
- [ ] Frontend build backup saved
- [ ] Environment variables documented
- [ ] Tested successfully in staging environment
- [ ] Team notified of maintenance window
- [ ] Users notified via email
- [ ] Status page prepared
- [ ] Rollback procedure reviewed
- [ ] Support team briefed

## Deployment Day

### 1. Pre-Migration (09:00 - 09:15)

- [ ] Enable maintenance mode
- [ ] Verify backup is recent (< 1 hour old)
- [ ] Disable background jobs
- [ ] Final database backup
- [ ] Post maintenance message to users

### 2. Database Migration (09:15 - 09:30)

- [ ] Run migration 001: Create companies table
- [ ] Verify companies table created
- [ ] Run migration 002: Add company_id columns
- [ ] Verify all tables have company_id column
- [ ] Run migration 003: Migrate existing data
- [ ] Verify data migrated (check companies table has 1+ rows)
- [ ] Run migration 004: Enforce NOT NULL constraints
- [ ] Verify no NULL company_id values remain

**Verification Query:**
```sql
SELECT
  'branches' as table_name,
  COUNT(*) FILTER (WHERE company_id IS NULL) as nulls
FROM branches
UNION ALL
SELECT 'users', COUNT(*) FILTER (WHERE company_id IS NULL) FROM users;
-- Should show 0 nulls for all tables
```

### 3. Backend Deployment (09:30 - 09:45)

- [ ] Deploy Lambda functions
- [ ] Verify deployment successful
- [ ] Test health endpoint
- [ ] Test new registration endpoint
- [ ] Test login endpoint
- [ ] Verify JWT contains companyId

**Quick Test:**
```bash
curl https://your-api.com/health
# Should return 200 OK
```

### 4. Frontend Deployment (09:45 - 10:00)

- [ ] Build frontend with production config
- [ ] Deploy to hosting (S3/Vercel)
- [ ] Invalidate CDN cache
- [ ] Verify frontend loads
- [ ] Test registration flow
- [ ] Test login flow

### 5. Post-Deployment (10:00 - 10:15)

- [ ] Disable maintenance mode
- [ ] Re-enable background jobs
- [ ] Run multi-tenant isolation tests
- [ ] Monitor error logs (15 minutes)
- [ ] Send "Upgrade Complete" email to users
- [ ] Update status page

### 6. Verification Tests (10:15 - 10:30)

Run the test script:
```bash
chmod +x test-multi-tenant.sh
API_URL=https://your-api.com ./test-multi-tenant.sh
```

**Manual Tests:**
- [ ] Register new company → Success
- [ ] Login with new company → Success
- [ ] Create student in Company A → Success
- [ ] Login to Company B → Cannot see Company A's student
- [ ] Old JWT tokens rejected → 401 error
- [ ] Profile includes companyId → Success
- [ ] Analytics dashboard shows company data only → Success
- [ ] Reports generated per company → Success

## Post-Deployment Monitoring (First 24 Hours)

### Hour 1 (10:00 - 11:00)
- [ ] Check error logs every 15 minutes
- [ ] Monitor authentication success rate
- [ ] Monitor API response times
- [ ] Check user feedback channels

### Hour 2-4 (11:00 - 13:00)
- [ ] Check error logs every 30 minutes
- [ ] Verify no data leakage reports
- [ ] Monitor database performance
- [ ] Check Lambda metrics

### Hour 4-24
- [ ] Check error logs every 2 hours
- [ ] Daily summary of metrics
- [ ] Review user support tickets
- [ ] Document any issues and resolutions

## Success Criteria

✅ Deployment is successful when:
- [ ] All migrations completed without errors
- [ ] Zero data leakage between companies
- [ ] All users can login after re-authentication
- [ ] New company registration works
- [ ] Error rate < 1%
- [ ] No P0/P1 bugs reported
- [ ] API response times normal (< 500ms p95)
- [ ] Database CPU < 70%
- [ ] Lambda error rate < 0.1%

## Rollback Triggers

❌ Initiate rollback if:
- [ ] Unable to complete migrations
- [ ] Data leakage detected between companies
- [ ] Authentication failure rate > 10%
- [ ] Database performance degraded > 50%
- [ ] Critical P0 bug discovered
- [ ] Data corruption detected

## Emergency Contacts

**On-Call Engineer:** _______________
**Database Admin:** _______________
**DevOps Lead:** _______________
**Product Owner:** _______________

## Rollback Procedure (Emergency)

If rollback needed:

1. **Immediate Actions:**
   - [ ] Enable maintenance mode
   - [ ] Stop all API traffic
   - [ ] Notify team in #incidents channel

2. **Database Rollback:**
   - [ ] Restore from pre-migration backup
   - [ ] Verify restoration successful
   - [ ] Test basic queries

3. **Application Rollback:**
   - [ ] Revert Lambda to previous version
   - [ ] Revert frontend to previous build
   - [ ] Clear CDN cache

4. **Verification:**
   - [ ] Test old login flow works
   - [ ] Verify data integrity
   - [ ] Check all major features

5. **Communication:**
   - [ ] Notify users of temporary rollback
   - [ ] Update status page
   - [ ] Schedule post-mortem

## Common Issues & Quick Fixes

### Issue: Users can't login
**Quick Fix:**
1. Check if JWT_SECRET changed
2. Verify database migration 004 completed
3. Check if companyId is in JWT payload

### Issue: 500 errors on registration
**Quick Fix:**
1. Check database transaction logs
2. Verify companies table exists
3. Check foreign key constraints

### Issue: Data visible across companies
**Quick Fix:**
1. Verify route file has `WHERE company_id = $1`
2. Check extractTenantContext is called
3. Review query parameters

### Issue: Old tokens still work
**Quick Fix:**
1. Verify JWT verification checks for companyId
2. Force token refresh by incrementing JWT version
3. Check token expiry settings

## Post-Deployment Follow-Up

### Day 1 (Evening)
- [ ] Review all error logs
- [ ] Check user support tickets
- [ ] Document any issues
- [ ] Send team summary email

### Day 2-7
- [ ] Daily error log review
- [ ] Monitor user feedback
- [ ] Track performance metrics
- [ ] Prepare week 1 report

### Week 2
- [ ] Complete post-deployment review
- [ ] Update documentation with learnings
- [ ] Plan next phase features
- [ ] Schedule retrospective meeting

## Notes Section

**Deployment Date:** _______________
**Deployment Time:** _______________
**Team Members Present:** _______________

**Issues Encountered:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

**Resolutions:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

**Lessons Learned:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________
