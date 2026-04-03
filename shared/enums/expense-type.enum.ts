export enum ExpenseType {
  FIXED = 'FIXED',       // Recurring monthly expenses (rent, salaries)
  VARIABLE = 'VARIABLE', // One-time operational expenses
  SHARED = 'SHARED',     // Global expenses distributed across branches
  CAPITAL = 'CAPITAL',   // Asset purchases amortized over time (laptop, AC, furniture)
}

export enum ExpenseCategory {
  RENT = 'RENT',
  UTILITIES = 'UTILITIES',
  ELECTRICITY = 'ELECTRICITY',
  INTERNET = 'INTERNET',
  WATER = 'WATER',
  MARKETING = 'MARKETING',
  SUPPLIES = 'SUPPLIES',
  EQUIPMENT = 'EQUIPMENT',
  MAINTENANCE = 'MAINTENANCE',
  INSURANCE = 'INSURANCE',
  SOFTWARE = 'SOFTWARE',
  ADMINISTRATION = 'ADMINISTRATION',
  OTHER = 'OTHER',
}

export enum DistributionMethod {
  EQUAL = 'EQUAL',               // Divide equally among branches
  PROPORTIONAL = 'PROPORTIONAL', // Divide based on revenue percentage
}
