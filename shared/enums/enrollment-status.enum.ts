export enum EnrollmentStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  DROPPED = 'DROPPED',
  PENDING = 'PENDING',
  ON_HOLD = 'ON_HOLD',
}

export enum PaymentStatus {
  PAID = 'PAID',
  PARTIAL = 'PARTIAL',
  PENDING = 'PENDING',
  OVERDUE = 'OVERDUE',
}

export enum PaymentMode {
  FULL = 'FULL',
  INSTALLMENTS = 'INSTALLMENTS',
  MONTHLY_SUBSCRIPTION = 'MONTHLY_SUBSCRIPTION',  // NEW
}

export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHECK = 'CHECK',
  OTHER = 'OTHER',
}
