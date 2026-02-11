# Automate Magic

## The Operating System for Multi-Location Service Businesses

A comprehensive **multi-tenant SaaS platform** for managing multi-location service businesses across industries. Track revenue, expenses, clients, employees, and gain real-time financial insights—all from one powerful dashboard.

### 🎯 Our Vision

**Building the Shopify for multi-location service businesses.** We're starting with robotics academies (our validated beachhead market with 3 paying customers), then expanding to all education verticals, and ultimately powering operations for any multi-location business.

**Current Focus:** Robotics & STEM Academies
**Roadmap:** Music Schools → Dance Studios → Fitness Centers → Healthcare Clinics → All Service Industries

**Why This Works:** 85% of our platform is industry-agnostic. We only customize 15% per vertical, enabling rapid expansion across industries.

## 🏢 Multi-Tenant Architecture

This application is a **true multi-tenant SaaS** with complete company-level data isolation:

- **Company-Level Isolation** - Each company has completely isolated data
- **Multiple Companies** - Support unlimited independent companies on the same platform
- **Subscription Management** - Built-in subscription tiers (BASIC, PROFESSIONAL, ENTERPRISE)
- **Secure Tenant Isolation** - JWT-based company context with mandatory filtering
- **Company Registration** - New companies self-register and get their own workspace

📚 **Documentation**:

**For Investors:**
- [**💰 Investor One-Pager**](./INVESTOR_ONE_PAGER_V2.md) - Quick investment overview
- [**📊 Financial Model**](./FINANCIAL_MODEL.md) - Detailed projections and unit economics
- [**🎤 Pitch Deck**](./PITCH_DECK.md) - Complete investor presentation
- [**🗺️ Market Expansion Strategy**](./MARKET_EXPANSION_STRATEGY.md) - Multi-vertical roadmap

**For Developers:**
- [**🚀 Quick Deploy**](./DEPLOY.md) - One-command deployment guide
- [**Multi-Tenant Transformation**](./MULTI_TENANT_TRANSFORMATION.md) - Complete implementation overview
- [**Developer Guide**](./MULTI_TENANT_DEV_GUIDE.md) - Quick reference for developers
- [**CDK Deployment**](./CDK_DEPLOYMENT.md) - AWS CDK deployment with personal profile
- [**Full Deployment Guide**](./DEPLOYMENT_GUIDE.md) - Comprehensive deployment instructions
- [**Deployment Checklist**](./DEPLOYMENT_CHECKLIST.md) - Day-of-deployment quick reference

## 🚀 Platform Features

### 🏗️ Core Platform (85% - Works Across All Industries)

**Multi-Tenant SaaS Foundation:**
- **🏢 Company Registration** - Self-service company registration with automatic workspace setup
- **🔒 Complete Data Isolation** - Each company's data is completely isolated from others
- **💳 Subscription Management** - Multiple subscription tiers (STARTER $199, PRO $399, ENTERPRISE $799)
- **👥 Multi-Company Support** - Unlimited companies on the same platform
- **🔐 Secure Tenant Context** - JWT-based company authentication and authorization

**Universal Business Operations:**
- **🏫 Multi-Location Management** - Manage unlimited locations from one unified dashboard
- **💰 Automated Revenue Tracking** - Revenue automatically generated from transactions (no manual entry)
- **📊 Financial Management** - Track revenue, expenses (fixed, variable, shared), payroll, and calculate net profit
- **👥 Client/Member Management** - Unified database for students, patients, customers, members, or clients
- **👨‍💼 Team Management** - Employee profiles, salaries, permissions, branch assignments
- **🗓️ Scheduling & Calendar** - Flexible scheduling system for classes, appointments, sessions, or shifts
- **📈 Real-Time Analytics** - Financial metrics, performance dashboards, location comparisons
- **📄 Advanced Reporting** - Generate Excel and PDF reports with custom date ranges
- **🔑 Role-Based Access Control** - Granular permissions (ADMIN, MANAGER, ACCOUNTANT roles)
- **🔐 Enterprise Security** - JWT authentication, password hashing, audit logs

### 🎓 Education Vertical (15% - Industry-Specific)

**Current Implementation (Robotics & STEM Academies):**
- **📚 Course & Program Management** - Create courses, define curriculum, set pricing
- **🗓️ Class Scheduling** - Run multiple sessions per course with different instructors and schedules
- **👨‍🎓 Student Enrollment** - Enrollment tracking with discounts and installment payments
- **📊 Academic Analytics** - Enrollment trends, course performance, student retention

**Coming Soon:**
- **🎸 Music Schools** - Instrument tracking, practice logs, recital management
- **💃 Dance Studios** - Costume orders, competition tracking, performance management
- **🥋 Martial Arts** - Belt progression system, testing schedules, tournament tracking
- **📖 Tutoring Centers** - Subject tracking, assessment tools, tutor matching

### 🔮 Future Verticals (Planned Expansion)

**Fitness & Wellness:** Class check-ins, membership plans, body metrics tracking
**Healthcare Services:** Patient records (HIPAA-compliant), insurance management, appointment notes
**Beauty & Personal Care:** Stylist management, product inventory, commission tracking
**Retail & Franchises:** POS integration, inventory management, supply chain
**Professional Services:** Case/project management, time tracking, client billing

## 🛠️ Technology Stack

Built with modern, scalable technologies for rapid multi-vertical expansion:

### Backend (API)
- **TypeScript** - Type-safe development across all modules
- **REST API** - RESTful architecture with industry-agnostic endpoints
- **SQL Database** - PostgreSQL for relational data with multi-tenant isolation
- **AWS Lambda** - Serverless architecture for infinite scalability
- **JWT Authentication** - Secure, stateless authentication

### Frontend
- **Angular 21** - Latest Angular with standalone components
- **PrimeNG** - Rich UI component library (100+ components)
- **Tailwind CSS** - Utility-first CSS for rapid UI customization
- **Chart.js** - Data visualization and analytics
- **RxJS** - Reactive programming for real-time updates

### Architecture Benefits
- ✅ **Multi-tenant from day 1** - Complete company isolation
- ✅ **Modular design** - 85% core platform, 15% vertical-specific
- ✅ **Rapid deployment** - Launch new vertical in 1-3 months
- ✅ **Infinite scalability** - Serverless auto-scaling
- ✅ **Cost-efficient** - Pay only for what you use

## 📁 Project Structure

```
automate-magic/
├── frontend/              # Angular 21 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/     # Services, guards, interceptors
│   │   │   ├── features/ # Feature modules (auth, dashboard, etc.)
│   │   │   └── shared/   # Shared components, pipes, directives
│   │   └── environments/
│   └── package.json
├── data/                  # Database seed files
│   └── seed/             # SQL seed scripts
└── package.json           # Root workspace configuration
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ or v20+ (recommended)
- **npm** v8+

### Installation

1. **Clone the repository**
   ```bash
   cd D:/work/automate-magic
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install

   # Install frontend dependencies
   npm run install:frontend
   ```

3. **Seed initial data** (optional)
   ```bash
   npm run seed
   ```

### Development

#### Run the frontend:
```bash
npm run dev
```

The frontend app will be available at: `http://localhost:4200`

**Note:** Make sure your REST API is running and configured properly in the environment settings.

### Build

```bash
# Build frontend
npm run build
```

## 🚀 Deployment

### Backend Deployment (AWS Lambda)

The backend REST API is deployed to AWS Lambda using a personal AWS profile (no SSO required).

#### Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   # Install AWS CLI (if not already installed)
   # Windows: Download from https://aws.amazon.com/cli/
   # macOS: brew install awscli
   # Linux: sudo apt-get install awscli
   ```

2. **AWS Personal Profile** configured with access key
   ```bash
   # Configure AWS profile
   aws configure --profile personal

   # You'll be prompted to enter:
   # - AWS Access Key ID
   # - AWS Secret Access Key
   # - Default region (e.g., us-east-1)
   # - Default output format (json)
   ```

3. **Serverless Framework** (if using)
   ```bash
   npm install -g serverless
   ```

#### Deploy Backend

Navigate to your backend/API directory and deploy:

```bash
# Using AWS CLI with personal profile
aws lambda update-function-code \
  --function-name your-api-function-name \
  --zip-file fileb://deployment-package.zip \
  --profile personal

# Or if using Serverless Framework
serverless deploy --aws-profile personal --stage production
```

#### Environment Variables

Make sure to set the required environment variables in AWS Lambda:
- `DATABASE_URL` - Your SQL database connection string
- `JWT_SECRET` - Secret key for JWT token generation
- `JWT_REFRESH_SECRET` - Secret key for refresh token
- Any other API keys or configuration

#### Database Setup

Ensure your SQL database is accessible from AWS Lambda:
1. If using RDS, configure security groups to allow Lambda access
2. Set up VPC configuration if needed
3. Run database migrations before deploying

#### Verify Deployment

Test your deployed API endpoint:
```bash
# Check API health
curl https://your-api-endpoint.amazonaws.com/health

# Test authentication
curl -X POST https://your-api-endpoint.amazonaws.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@automate-magic.com","password":"admin123"}'
```

### Frontend Deployment

Frontend is not yet hosted. When ready to deploy:
- Update `environment.production.ts` with your production API endpoint
- Build for production: `npm run build`
- Deploy to hosting service (AWS S3 + CloudFront, Vercel, Netlify, etc.)

## 🔐 Default Credentials

After seeding the database, use these credentials to log in:

- **Admin User:**
  - Email: `admin@automate-magic.com`
  - Password: `admin123`

- **Branch Manager:**
  - Email: `manager@automate-magic.com`
  - Password: `manager123`

## 📊 Financial Calculations

The system calculates net profit using the following formula:

```
Net Profit = Total Revenue - (Fixed Expenses + Variable Expenses + Salaries + Shared Expenses)
```

### Expense Types:
- **Fixed** - Recurring monthly expenses (rent, utilities)
- **Variable** - One-time expenses
- **Shared** - Global expenses distributed across branches (equally or proportionally)

### Revenue Tracking:
Revenues are **automatically generated** from two sources:
- **Course Enrollments** - When students enroll in courses (with support for discounts and installments)
- **Product Sales** - When products are sold

**Important:** You cannot manually create, edit, or delete revenue entries. All revenue is tracked automatically based on enrollments and sales transactions. This ensures accurate financial reporting and prevents manual data entry errors.

## 📊 Market Opportunity

### Current Traction (Beachhead Market)
- ✅ **3 Paying Customers** (Robotics Academies)
- ✅ **$750 MRR / $9,000 ARR**
- ✅ **0% Churn Rate**
- ✅ **Multi-location operators** (customers manage 2-4 locations each)

### Expansion Roadmap

| Phase | Timeline | Target Market | Businesses | SAM |
|-------|----------|---------------|------------|-----|
| **Phase 1** | Year 1-2 | Robotics & STEM Academies | 15,000 | $54M |
| **Phase 2** | Year 2-3 | All Education Verticals | 200,000 | $720M |
| **Phase 3** | Year 3-5 | Fitness, Healthcare, Retail | 1,000,000 | $4.2B |

**Total Addressable Market:** $4.2B+ across 1 million multi-location service businesses

### Why This Strategy Works

**Beachhead Validation:**
- Start narrow (robotics) to prove product-market fit
- Tight-knit community enables word-of-mouth growth
- Multi-location operators validate core value proposition

**Platform Leverage:**
- 85% of codebase works across all industries
- Only 15% customization needed per vertical
- Ship new vertical in 1-3 months (not 12+ months)

**Comparable Success Stories:**
- **Shopify:** Started with small stores → $150B market cap
- **Toast:** Started with restaurants → $10B valuation
- **Mindbody:** Started with yoga studios → $1.9B acquisition

## 📚 Example: Course & Class System (Education Vertical)

The platform uses a flexible **Program-to-Session** model (terminology adapts per industry):

### Programs/Courses
- Templates for offerings (e.g., "Robotics 101", "Piano Lessons", "Yoga Class")
- Define pricing, duration, and default instructor/provider
- Can be offered across multiple locations

### Sessions/Classes
- Specific scheduled instances of a program
- Multiple sessions can run simultaneously or at different times
- Each session has:
  - **Independent scheduling**: Start/end dates, times, days of week
  - **Custom instructor/provider**: Defaults to program instructor
  - **Capacity tracking**: Maximum participants and current enrollment
  - **Unique identifier**: For easy tracking

### Example (Robotics Academy)
"Robotics 101" course with three classes:
- **Class A**: Morning session (9 AM - 11 AM), Mon/Wed, taught by Instructor Smith
- **Class B**: Evening session (5 PM - 7 PM), Tue/Thu, taught by Instructor Jones
- **Class C**: Weekend session (10 AM - 12 PM), Saturdays, taught by Instructor Brown

**This same model adapts to:**
- Music schools (lesson types → individual lessons)
- Fitness studios (class types → scheduled classes)
- Healthcare (service types → appointments)
- Professional services (service packages → consultations)

## 🗂️ Data Storage & Scalability

**SQL Database (PostgreSQL)** provides:
- Reliable and scalable data persistence
- ACID compliance for data integrity
- Efficient querying and indexing
- Multi-tenant data isolation with company_id filtering
- Perfect for small businesses to enterprise scale

**Designed to scale:**
- ✅ Handles 1-10 locations per customer
- ✅ Supports 10,000+ customers on shared infrastructure
- ✅ AWS RDS with automatic backups and failover
- ✅ Read replicas for analytics and reporting

Database seed scripts are located in the `data/seed/` directory for initial setup.

## 🔒 Enterprise-Grade Security

- **Multi-Tenant Isolation** - Complete data isolation between companies with mandatory company_id filtering
- **JWT-Based Tenant Context** - Company ID embedded in JWT token for secure tenant identification
- **Role-Based Access Control** - ADMIN (company-wide), BRANCH_MANAGER (location-specific), ACCOUNTANT roles
- **Password Security** - Password hashing with bcrypt (industry standard)
- **Token Management** - Secure JWT access and refresh tokens with automatic expiration
- **Request Validation** - All API requests validated for company ownership
- **Database Constraints** - Foreign key constraints ensure referential integrity
- **Location-Level Permissions** - Fine-grained access control at location level
- **Audit Logging** - Track all critical operations (coming soon)
- **SOC 2 Compliance Roadmap** - Preparing for enterprise customers

**Industry-Specific Security:**
- Healthcare vertical will include HIPAA compliance
- Payment processing with PCI-DSS compliance
- GDPR-ready for international expansion

## 📱 Responsive Design

The application is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile devices (optimized for tablet and above)

## 🎨 UI Components

Built with PrimeNG and Tailwind CSS:
- Modern, clean design
- Consistent UI across all pages
- Accessible components
- Dark mode ready (can be enabled)

## 🧪 Testing

```bash
# Frontend tests
cd frontend && npm test
```

## 🗑️ Delete Confirmation

For safety and data protection, all delete operations in the application require:
- A confirmation dialog to prevent accidental deletions
- Users must type **"delete"** (case-sensitive) to confirm the deletion
- This applies to all entities: programs/courses, locations/branches, clients/students, expenses, etc.

This two-step confirmation process ensures that critical data is not accidentally removed.

## 🌍 Industry Adaptability

Our platform terminology automatically adapts to each industry:

| Concept | Robotics Academy | Music School | Fitness Studio | Healthcare Clinic |
|---------|------------------|--------------|----------------|-------------------|
| **Locations** | Branches | Locations | Studios | Clinics |
| **Clients** | Students | Students | Members | Patients |
| **Programs** | Courses | Lessons | Classes | Services |
| **Sessions** | Classes | Lessons | Sessions | Appointments |
| **Staff** | Instructors | Teachers | Trainers | Providers |
| **Revenue Source** | Enrollments | Lessons | Memberships | Appointments |

**Same platform. Different language. Infinite possibilities.**

## 💼 For Investors

**We're raising $250K at $1.8M pre-money valuation (13.8% equity)**

### Investment Highlights:
- ✅ **Validated Beachhead:** 3 paying customers, $750 MRR, 0% churn
- ✅ **Massive TAM:** $4.2B SAM across 1M+ multi-location businesses
- ✅ **Platform Leverage:** 85% shared codebase = exponential returns
- ✅ **Strong Unit Economics:** 7.6:1 LTV:CAC, 85% gross margins, 3.9mo payback
- ✅ **Clear Path to Profitability:** Break-even at 60 customers (Month 12)
- ✅ **Proven Playbook:** Following Shopify/Toast/Mindbody expansion strategy

📄 **Read:** [Investor One-Pager](./INVESTOR_ONE_PAGER_V2.md) | [Financial Model](./FINANCIAL_MODEL.md) | [Pitch Deck](./PITCH_DECK.md)

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Contact

**For business inquiries:** business@automate-magic.com
**For support:** support@automate-magic.com
**For investment opportunities:** investors@automate-magic.com

## 🎯 Current Status

**Stage:** Seed-stage, raising capital
**Customers:** 3 robotics academies (multi-location operators)
**MRR:** $750 | **ARR:** $9,000
**Team:** [Founder names]
**Headquarters:** [Location]

---

**Building the operating system for 1 million multi-location service businesses worldwide.**

*Starting with robotics academies. Expanding to every industry.* 🚀
