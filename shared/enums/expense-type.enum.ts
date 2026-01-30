export enum ExpenseType {
  FIXED = 'FIXED',       // Recurring monthly expenses
  VARIABLE = 'VARIABLE', // One-time expenses
  SHARED = 'SHARED',     // Global expenses distributed across branches
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
