# Student Churn Rate Report Feature

## Overview
Added a comprehensive churn rate analysis feature that tracks which students left your platform, calculates churn rates by branch, and provides detailed insights to improve student retention.

## What's New

### Backend Changes

#### 1. Student Interface Update (`shared/interfaces/student.interface.ts`)
- Added `churnDate?: string` - Records the exact date a student left
- Added `churnReason?: string` - Optional field to capture why the student churned

#### 2. Students Service (`backend/src/students/students.service.ts`)
- **Updated `remove()` method**: Automatically sets `churnDate` when student is marked inactive
- **Updated `update()` method**:
  - Sets `churnDate` when `isActive` is changed to false
  - Clears `churnDate` and `churnReason` when student is reactivated

#### 3. Analytics Service (`backend/src/analytics/analytics.service.ts`)
- **New method**: `getChurnAnalysis(startDate?, endDate?)`
- Features:
  - Calculates overall churn rate
  - Breaks down churn by branch
  - Tracks student duration before churning
  - Filters churned students by date range
  - Enriches data with branch information

#### 4. Excel Generator Service (`backend/src/reports/generators/excel-generator.service.ts`)
- **New method**: `generateChurnReport()`
- Creates a multi-sheet Excel workbook with:
  - **Summary Sheet**: Overall statistics and branch-wise analysis
  - **Detail Sheet**: Complete list of all churned students

#### 5. Reports Service (`backend/src/reports/reports.service.ts`)
- **New method**: `generateChurnReportExcel()`
- Orchestrates data fetching and Excel generation

#### 6. Reports Controller (`backend/src/reports/reports.controller.ts`)
- **New endpoint**: `GET /api/reports/excel/churn`
- Query parameters: `startDate`, `endDate`
- Authentication: ADMIN, ACCOUNTANT, and BRANCH_MANAGER roles
- Returns Excel file with comprehensive churn analysis

### Frontend Changes

#### 1. Report Service (`frontend/src/app/features/reports/services/report.service.ts`)
- **New method**: `downloadChurnReportExcel()`
- Generates the proper API URL with date parameters

#### 2. Report List Component (`frontend/src/app/features/reports/report-list/report-list.component.ts`)
- **New method**: `downloadChurnReportExcel()`
- Validates date inputs
- Triggers download with authentication
- Shows success notification

#### 3. Report List Template (`frontend/src/app/features/reports/report-list/report-list.component.html`)
- **New card**: "Student Churn Rate Report" with users icon
- Date range inputs (reuses financial report dates)
- Orange "Download Churn Report" button
- Info tooltip explaining included data
- Updated information section with churn report details

## Excel Report Structure

### Sheet 1: Churn Summary

**Overall Summary Section:**
- Total Students
- Active Students (highlighted in green)
- Churned Students (highlighted in red)
- Overall Churn Rate % (highlighted in gold)

**Branch-wise Churn Analysis Table:**
| Column | Description |
|--------|-------------|
| Branch | Branch name and code |
| Total Students | All students (active + churned) |
| Active | Currently active students |
| Churned | Students who left |
| Churn Rate % | Percentage of churned students |

**Color Coding:**
- 🔴 Red: Churn rate > 20% (High risk)
- 🟡 Yellow: Churn rate 10-20% (Medium risk)
- ⚪ White: Churn rate < 10% (Low risk)

### Sheet 2: Churned Students Detail

Detailed list of all churned students with columns:
- Student Name
- Email
- Phone
- Branch (name and code)
- Enrollment Date
- Churn Date
- Duration (Months) - How long they stayed
- Churn Reason - Why they left

## How to Use

### From the UI:
1. Navigate to Reports page
2. Find "Student Churn Rate Report" card (with users icon)
3. Select start and end dates for analysis period
4. Click "Download Churn Report"
5. Excel file downloads with two sheets of data

### API Endpoint:
```bash
GET http://localhost:3000/api/reports/excel/churn?startDate=2024-01-01&endDate=2026-01-31
Authorization: Bearer <jwt-token>
```

## Churn Rate Calculation

```
Churn Rate = (Number of Churned Students / Total Students) × 100
```

**Example:**
- Total Students: 100
- Churned Students: 15
- Churn Rate: 15%

## Example Use Cases

### Year-End Review
```
Start Date: 2025-01-01
End Date: 2025-12-31
Result: Full year churn analysis with all students who left in 2025
```

### Quarterly Analysis
```
Start Date: 2025-10-01
End Date: 2025-12-31
Result: Q4 churn data for focused retention planning
```

### Multi-Year Comparison
```
Start Date: 2024-01-01
End Date: 2025-12-31
Result: 2-year churn trends for long-term analysis
```

## Key Insights You Can Get

1. **Identify Problem Branches**: Which branches have the highest churn rates?
2. **Duration Analysis**: How long do students typically stay before leaving?
3. **Churn Patterns**: Are there seasonal patterns in student departures?
4. **Retention Opportunities**: Which students recently churned that could be re-engaged?
5. **Success Metrics**: Track improvements in retention over time

## Testing

The endpoint has been tested and verified:
- ✅ Status: 200 OK
- ✅ Response: Excel file (8,131 bytes)
- ✅ Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- ✅ Authentication: Working with JWT tokens
- ✅ Two sheets generated correctly

## Benefits

1. **Track Student Retention**: Monitor which students are leaving
2. **Branch Performance**: Compare retention across different locations
3. **Data-Driven Decisions**: Make informed decisions about retention strategies
4. **Early Warning System**: Identify branches with high churn for intervention
5. **ROI Measurement**: Track the impact of retention initiatives

## Technical Details

- **Backend Port**: 3000
- **Frontend Port**: 4200
- **File Format**: XLSX (Excel with multiple sheets)
- **Authentication**: JWT Bearer Token
- **Roles**: ADMIN, ACCOUNTANT, BRANCH_MANAGER
- **Date Format**: YYYY-MM-DD

## Data Tracking

When a student is marked as inactive (churned):
- `isActive` is set to `false`
- `churnDate` is automatically set to current date
- Optional `churnReason` can be added manually
- `updatedAt` timestamp is updated

When a student is reactivated:
- `isActive` is set to `true`
- `churnDate` is cleared
- `churnReason` is cleared

## Future Enhancements (Suggestions)

- Add churn reason categories (dropdown in UI)
- Track attempted re-engagement efforts
- Calculate customer lifetime value (CLV)
- Predictive churn modeling
- Automated alerts for high churn branches
- Churn trend graphs and visualizations

## Notes

- Students without a `churnDate` but with `isActive: false` won't appear in the report (legacy data)
- The duration is calculated from enrollment date to churn date
- Churn rate is calculated based on total students ever enrolled, not just active
- Color coding helps quickly identify high-risk branches
- Both sheets are formatted with professional borders and styling
