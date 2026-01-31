"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentMethod = exports.PaymentStatus = exports.EnrollmentStatus = void 0;
var EnrollmentStatus;
(function (EnrollmentStatus) {
    EnrollmentStatus["ACTIVE"] = "ACTIVE";
    EnrollmentStatus["COMPLETED"] = "COMPLETED";
    EnrollmentStatus["DROPPED"] = "DROPPED";
    EnrollmentStatus["PENDING"] = "PENDING";
})(EnrollmentStatus || (exports.EnrollmentStatus = EnrollmentStatus = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PAID"] = "PAID";
    PaymentStatus["PARTIAL"] = "PARTIAL";
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["OVERDUE"] = "OVERDUE";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["CASH"] = "CASH";
    PaymentMethod["CREDIT_CARD"] = "CREDIT_CARD";
    PaymentMethod["DEBIT_CARD"] = "DEBIT_CARD";
    PaymentMethod["BANK_TRANSFER"] = "BANK_TRANSFER";
    PaymentMethod["CHECK"] = "CHECK";
    PaymentMethod["OTHER"] = "OTHER";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
//# sourceMappingURL=enrollment-status.enum.js.map