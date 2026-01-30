# 🚀 Quick Start Guide

## Get Up and Running in 5 Minutes

### Step 1: Install Dependencies (2 minutes)

```bash
cd D:/work/automate-magic

# Install root dependencies
npm install

# Install backend
cd backend
npm install
cd ..

# Install frontend
cd frontend
npm install
cd ..
```

### Step 2: Seed Database (30 seconds)

```bash
cd backend
npm run seed
```

You should see:
```
🌱 Starting data seeding...
✓ Users seeded
✓ Branches seeded
✓ Courses seeded
✓ Students seeded
✓ Enrollments seeded
✓ Employees seeded
✓ Revenues seeded
✓ Expenses seeded
🎉 Data seeding completed successfully!
```

### Step 3: Start Development Servers (1 minute)

**Option A: Run Both Together (Recommended)**
```bash
# From root directory
npm run dev
```

**Option B: Run Separately**
```bash
# Terminal 1 - Backend
cd backend
npm run start:dev

# Terminal 2 - Frontend
cd frontend
npm start
```

### Step 4: Login (30 seconds)

1. Open browser: http://localhost:4200
2. Login with:
   - Email: `admin@automate-magic.com`
   - Password: `admin123`

### Step 5: Explore! 🎉

✅ **Dashboard** - View financial metrics and charts
✅ **Branches** - Manage branch locations
✅ **Courses** - Create and manage courses
✅ **Students** - Enroll students and track progress

---

## Test the API

### Health Check
```bash
curl http://localhost:3000/api/health
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@automate-magic.com","password":"admin123"}'
```

### Get Dashboard (with token)
```bash
curl http://localhost:3000/api/analytics/dashboard \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Default Users

**Admin** (Full Access)
- Email: `admin@automate-magic.com`
- Password: `admin123`

**Branch Manager** (Branch-Specific)
- Email: `manager@automate-magic.com`
- Password: `manager123`

**Accountant** (Read-Only Financial)
- Email: `accountant@automate-magic.com`
- Password: `accountant123`

---

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3000 (backend)
npx kill-port 3000

# Kill process on port 4200 (frontend)
npx kill-port 4200
```

### Data Reset
```bash
cd backend
npm run seed
```

### Dependency Conflicts
If you encounter dependency conflicts during installation:
```bash
cd frontend
npm install --legacy-peer-deps
```

**Note**: This project uses PrimeNG v21 which is fully compatible with Angular 21.

### Clear Node Modules
```bash
# Backend
cd backend
rm -rf node_modules
npm install

# Frontend
cd frontend
rm -rf node_modules
npm install
```

---

## What's Next?

1. ✅ Explore the dashboard
2. ✅ Create a new branch
3. ✅ Add courses to your branch
4. ✅ Enroll students
5. ✅ View financial reports
6. ✅ Export reports to Excel/PDF

**Need Help?** Check `IMPLEMENTATION_COMPLETE.md` for full documentation.

Happy coding! 🎉
