# Automate Magic

## Robotics Academy Management Platform

A comprehensive SaaS platform for managing robotics academies with multiple branches. Track revenue, expenses, courses, students, employees, and gain real-time financial insights.

## 🚀 Features

- **Multi-Branch Management** - Manage multiple academy locations from one platform
- **Automated Revenue Tracking** - Revenues are automatically generated from course enrollments and product sales (no manual entry required)
- **Financial Tracking** - Track revenue, expenses (fixed, variable, shared), and calculate net profit
- **Student Management** - Enroll students, manage courses, apply discounts
- **Employee Management** - Track salaries, assign to branches or globally
- **Course & Class Management** - Create courses, schedule multiple classes for each course, assign instructors
- **Class Scheduling** - Run multiple sessions (classes) for the same course with different instructors, schedules, and dates
- **Analytics Dashboard** - Real-time financial metrics and visualizations
- **Reports** - Generate Excel and PDF reports for financial summaries
- **Role-Based Access** - Admin, Branch Manager, and Accountant roles
- **Secure Authentication** - JWT-based authentication with refresh tokens

## 🛠️ Technology Stack

### API
- **TypeScript** - Type-safe development
- **REST API** - RESTful API architecture
- **SQL Database** - Relational database for data persistence
- **JWT** - Secure authentication

### Frontend
- **Angular 21** - Latest Angular with standalone components
- **PrimeNG** - Rich UI component library
- **Tailwind CSS** - Utility-first CSS framework
- **Chart.js** - Data visualization
- **RxJS** - Reactive programming

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

## 📚 Course & Class System

The platform uses a **Course-to-Class** model to provide flexible scheduling:

### Courses
- A **Course** is a template/program (e.g., "Robotics 101", "Advanced Programming")
- Defines the curriculum, price, duration, and default instructor
- Can be offered across multiple branches

### Classes
- A **Class** is a specific scheduled session/instance of a course
- One course can have multiple classes running simultaneously or at different times
- Each class has:
  - **Independent scheduling**: Start/end dates, class times, days of week
  - **Custom instructor**: Defaults to course instructor, but can be changed
  - **Enrollment tracking**: Maximum students and current enrollment count
  - **Unique code**: For easy identification (e.g., "ROB-101-A", "ROB-101-B")

### Example
For a "Robotics 101" course, you might create:
- **Class A**: Morning session (9 AM - 11 AM), Mon/Wed, taught by Instructor Smith
- **Class B**: Evening session (5 PM - 7 PM), Tue/Thu, taught by Instructor Jones
- **Class C**: Weekend session (10 AM - 12 PM), Saturdays, taught by Instructor Brown

Students enroll in specific **classes**, not just courses. This provides detailed tracking and flexibility for different schedules and instructors.

## 🗂️ Data Storage

This application uses a SQL database for data storage, providing:
- Reliable and scalable data persistence
- ACID compliance for data integrity
- Efficient querying and indexing
- Perfect for small to large-sized academies

Database seed scripts are located in the `data/seed/` directory for initial setup.

## 🔒 Security

- JWT-based authentication with access and refresh tokens
- Password hashing with bcrypt
- Role-based access control (RBAC)
- HTTP-only secure token storage
- Request validation and sanitization

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
- This applies to all entities: courses, branches, students, expenses, etc.

This two-step confirmation process ensures that critical data is not accidentally removed.

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For support, email support@automate-magic.com or open an issue in the repository.

---

**Built with ❤️ for robotics education**
