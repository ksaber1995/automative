# Monthly Financial Report Feature

## Overview
Added a new monthly breakdown report feature that allows users to download financial reports with month-by-month data to track growth and trends over time.

## What's New

### Backend Changes

#### 1. Excel Generator Service (`backend/src/reports/generators/excel-generator.service.ts`)
- Added new method: `generateMonthlyFinancialReport()`
- Features:
  - Month-by-month revenue breakdown
  - Monthly expense categories (Fixed, Variable, Salaries, Shared)
  - Profit margin calculation per month
  - **Growth percentage tracking** (compares each month to the previous)
  - Automatic totals row with summary statistics
  - Professional formatting with color-coded headers

#### 2. Analytics Service (`backend/src/analytics/analytics.service.ts`)
- Added new method: `getMonthlyFinancialBreakdown()`
- Automatically splits date range into monthly periods
- Calculates financial metrics for each month
- Returns structured data for Excel generation

#### 3. Reports Service (`backend/src/reports/reports.service.ts`)
- Added new method: `generateMonthlyFinancialReportExcel()`
- Orchestrates data fetching and Excel generation

#### 4. Reports Controller (`backend/src/reports/reports.controller.ts`)
- Added new endpoint: `GET /api/reports/excel/financial-monthly`
- Query parameters: `startDate`, `endDate`
- Authentication: ADMIN and ACCOUNTANT roles only
- Returns Excel file with month-by-month breakdown

### Frontend Changes

#### 1. Report Service (`frontend/src/app/features/reports/services/report.service.ts`)
- Added method: `downloadMonthlyFinancialReportExcel()`
- Generates the proper API URL with parameters

#### 2. Report List Component (`frontend/src/app/features/reports/report-list/report-list.component.ts`)
- Added method: `downloadMonthlyFinancialExcel()`
- Validates date inputs
- Triggers download with authentication
- Shows success notification

#### 3. Report List Template (`frontend/src/app/features/reports/report-list/report-list.component.html`)
- Added new card: "Monthly Financial Report"
- Calendar icon for easy identification
- Date range inputs (reuses financial report dates)
- Download button with info tooltip
- Updated information section with monthly report details

## Excel Report Columns

The monthly report includes the following columns:

| Column | Description |
|--------|-------------|
| Month | Month and year (e.g., "Jan 2025") |
| Revenue | Total revenue for the month |
| Fixed Expenses | Recurring branch expenses |
| Variable Expenses | One-time branch expenses |
| Salaries | Total employee salaries |
| Shared Expenses | Distributed shared costs |
| Total Expenses | Sum of all expenses |
| Net Profit | Revenue minus total expenses |
| Profit Margin % | (Net Profit / Revenue) × 100 |
| Growth % | Percentage change from previous month |

## How to Use

### From the UI:
1. Navigate to Reports page
2. Find "Monthly Financial Report" card
3. Select start and end dates (e.g., entire year)
4. Click "Download Monthly Excel"
5. Excel file downloads with month-by-month breakdown

### API Endpoint:
```
GET http://localhost:3000/api/reports/excel/financial-monthly?startDate=2025-01-01&endDate=2025-12-31
Authorization: Bearer <jwt-token>
```

## Example Use Cases

### Year-over-Year Comparison
```
Start Date: 2024-01-01
End Date: 2025-12-31
Result: 24 months of data showing trends across 2 years
```

### Quarterly Analysis
```
Start Date: 2025-01-01
End Date: 2025-03-31
Result: 3 months of Q1 data with growth metrics
```

### Full Year Report
```
Start Date: 2025-01-01
End Date: 2025-12-31
Result: 12 months of data with monthly growth tracking
```

## Testing

The endpoint has been tested and verified:
- Status: ✅ 200 OK
- Response: Excel file (8,199 bytes)
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Authentication: Working with JWT tokens

## Benefits

1. **Track Growth**: See month-over-month growth percentages
2. **Identify Trends**: Spot seasonal patterns and trends
3. **Data-Driven Decisions**: Make informed decisions based on historical data
4. **Easy Comparison**: Compare different months at a glance
5. **Professional Reports**: Well-formatted Excel files ready for presentations

## Technical Details

- **Backend Port**: 3000
- **Frontend Port**: 4200 (assumed)
- **File Format**: XLSX (Excel)
- **Authentication**: JWT Bearer Token
- **Roles**: ADMIN, ACCOUNTANT
- **Date Format**: YYYY-MM-DD

## Notes

- The growth percentage is calculated by comparing each month to the previous month
- First month always shows 0% growth (no previous month to compare)
- Totals row provides aggregate statistics for the entire period
- All currency values formatted with $ symbol
- Percentage values formatted with % symbol
- Professional borders and styling applied automatically
