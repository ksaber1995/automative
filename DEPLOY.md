# Quick Deployment

## 🚀 One-Command Deployment

```bash
cd aws && ./deploy.sh prod personal
```

That's it! The script will handle everything.

## 📋 What It Does

1. Installs dependencies
2. Builds Lambda function
3. Synthesizes CDK stack
4. Shows deployment changes
5. Asks for confirmation
6. Deploys to AWS

## ⚠️ Before You Deploy

### 1. Run Database Migrations First

```bash
# From project root
./run-migrations.sh
```

### 2. Verify Migration Success

```bash
./verify-database.sh
```

You should see: `✓ MIGRATION SUCCESSFUL`

## 🎯 After Deployment

1. **Copy API URL** from deployment output
2. **Update frontend** with new API URL
3. **Test the API**:
   ```bash
   curl https://your-api-url/health
   ```
4. **Run isolation tests**:
   ```bash
   API_URL=https://your-api-url ./test-multi-tenant.sh
   ```

## 🔧 Manual CDK Command (Alternative)

If you prefer the direct command:

```bash
cd aws
npm install
cd lambda/api && npm install && npm run build && cd ../..
cdk deploy --profile personal
```

## 📚 Detailed Documentation

- **Full Deployment Guide**: CDK_DEPLOYMENT.md
- **Database Migrations**: DEPLOYMENT_GUIDE.md
- **Troubleshooting**: MULTI_TENANT_DEV_GUIDE.md

---

**Ready to deploy?** Run: `cd aws && ./deploy.sh prod personal`
