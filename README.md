# Automate Magic

## Robotics Academy Management Platform

A comprehensive SaaS platform for managing robotics academies with multiple branches. Track revenue, expenses, courses, students, employees, and gain real-time financial insights.

## 🚀 Features

- **Multi-Branch Management** - Manage multiple academy locations from one platform
- **Financial Tracking** - Track revenue, expenses (fixed, variable, shared), and calculate net profit
- **Student Management** - Enroll students, manage courses, apply discounts
- **Employee Management** - Track salaries, assign to branches or globally
- **Analytics Dashboard** - Real-time financial metrics and visualizations
- **Reports** - Generate Excel and PDF reports for financial summaries
- **Role-Based Access** - Admin, Branch Manager, and Accountant roles
- **Secure Authentication** - JWT-based authentication with refresh tokens

## 🛠️ Technology Stack

### Backend
- **NestJS** - Progressive Node.js framework
- **TypeScript** - Type-safe development
- **JSON Files** - Simple file-based data storage (no database required)
- **JWT** - Secure authentication
- **ExcelJS & PDFKit** - Report generation

### Frontend
- **Angular 21** - Latest Angular with standalone components
- **PrimeNG** - Rich UI component library
- **Tailwind CSS** - Utility-first CSS framework
- **Chart.js** - Data visualization
- **RxJS** - Reactive programming

## 📁 Project Structure

```
automate-magic/
├── backend/                # NestJS backend API
│   ├── src/
│   │   ├── data-store/    # JSON file management service
│   │   ├── auth/          # Authentication module (to be implemented)
│   │   ├── branches/      # Branch management (to be implemented)
│   │   └── ...
│   └── package.json
├── frontend/              # Angular 21 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/     # Services, guards, interceptors
│   │   │   ├── features/ # Feature modules (auth, dashboard, etc.)
│   │   │   └── shared/   # Shared components, pipes, directives
│   │   └── environments/
│   └── package.json
├── shared/                # Shared TypeScript interfaces/enums
│   ├── interfaces/        # Entity interfaces
│   ├── enums/            # Application enums
│   └── index.ts
├── data/                  # JSON data files
│   ├── users.json
│   ├── branches.json
│   └── ...
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

   # Install backend dependencies
   npm run install:backend

   # Install frontend dependencies
   npm run install:frontend
   ```

3. **Seed initial data** (optional)
   ```bash
   npm run seed
   ```

### Development

#### Run both backend and frontend concurrently:
```bash
npm run dev
```

#### Or run separately:

**Terminal 1 - Backend:**
```bash
npm run backend:dev
```
The backend API will be available at: `http://localhost:3000`

**Terminal 2 - Frontend:**
```bash
npm run frontend:dev
```
The frontend app will be available at: `http://localhost:4200`

### Build

```bash
# Build both backend and frontend
npm run build

# Build backend only
npm run backend:build

# Build frontend only
npm run frontend:build
```

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

## 🗂️ Data Storage

This application uses JSON files for data storage, making it:
- Easy to set up (no database installation required)
- Portable and lightweight
- Perfect for small to medium-sized academies

Data files are located in the `data/` directory. The DataStoreService provides:
- File locking for concurrent access safety
- Atomic writes to prevent data corruption
- Automatic backups before modifications

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
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For support, email support@automate-magic.com or open an issue in the repository.

---

**Built with ❤️ for robotics education**
