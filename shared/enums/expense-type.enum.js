"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributionMethod = exports.ExpenseCategory = exports.ExpenseType = void 0;
var ExpenseType;
(function (ExpenseType) {
    ExpenseType["FIXED"] = "FIXED";
    ExpenseType["VARIABLE"] = "VARIABLE";
    ExpenseType["SHARED"] = "SHARED";
})(ExpenseType || (exports.ExpenseType = ExpenseType = {}));
var ExpenseCategory;
(function (ExpenseCategory) {
    ExpenseCategory["RENT"] = "RENT";
    ExpenseCategory["UTILITIES"] = "UTILITIES";
    ExpenseCategory["ELECTRICITY"] = "ELECTRICITY";
    ExpenseCategory["INTERNET"] = "INTERNET";
    ExpenseCategory["WATER"] = "WATER";
    ExpenseCategory["MARKETING"] = "MARKETING";
    ExpenseCategory["SUPPLIES"] = "SUPPLIES";
    ExpenseCategory["EQUIPMENT"] = "EQUIPMENT";
    ExpenseCategory["MAINTENANCE"] = "MAINTENANCE";
    ExpenseCategory["INSURANCE"] = "INSURANCE";
    ExpenseCategory["SOFTWARE"] = "SOFTWARE";
    ExpenseCategory["ADMINISTRATION"] = "ADMINISTRATION";
    ExpenseCategory["OTHER"] = "OTHER";
})(ExpenseCategory || (exports.ExpenseCategory = ExpenseCategory = {}));
var DistributionMethod;
(function (DistributionMethod) {
    DistributionMethod["EQUAL"] = "EQUAL";
    DistributionMethod["PROPORTIONAL"] = "PROPORTIONAL";
})(DistributionMethod || (exports.DistributionMethod = DistributionMethod = {}));
//# sourceMappingURL=expense-type.enum.js.map