#!/bin/bash

# Multi-Tenant Isolation Testing Script
# This script tests that tenant isolation is working correctly

set -e

API_URL="${API_URL:-http://localhost:3000}"
echo "Testing Multi-Tenant Isolation on: $API_URL"
echo "================================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print test results
pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    exit 1
}

info() {
    echo -e "${YELLOW}ℹ INFO:${NC} $1"
}

echo ""
info "Test 1: Register Company A"
COMPANY_A_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Company A",
    "companyEmail": "companya@test.local",
    "firstName": "Alice",
    "lastName": "Anderson",
    "email": "alice@companya.local",
    "password": "testpassword123"
  }')

COMPANY_A_TOKEN=$(echo $COMPANY_A_RESPONSE | jq -r '.accessToken')
COMPANY_A_ID=$(echo $COMPANY_A_RESPONSE | jq -r '.user.companyId')
COMPANY_A_BRANCH_ID=$(echo $COMPANY_A_RESPONSE | jq -r '.user.branchId')

if [ "$COMPANY_A_TOKEN" != "null" ] && [ "$COMPANY_A_TOKEN" != "" ]; then
    pass "Company A registered successfully"
    info "Company A ID: $COMPANY_A_ID"
    info "Company A Branch ID: $COMPANY_A_BRANCH_ID"
else
    fail "Failed to register Company A"
fi

echo ""
info "Test 2: Register Company B"
COMPANY_B_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Company B",
    "companyEmail": "companyb@test.local",
    "firstName": "Bob",
    "lastName": "Brown",
    "email": "bob@companyb.local",
    "password": "testpassword123"
  }')

COMPANY_B_TOKEN=$(echo $COMPANY_B_RESPONSE | jq -r '.accessToken')
COMPANY_B_ID=$(echo $COMPANY_B_RESPONSE | jq -r '.user.companyId')
COMPANY_B_BRANCH_ID=$(echo $COMPANY_B_RESPONSE | jq -r '.user.branchId')

if [ "$COMPANY_B_TOKEN" != "null" ] && [ "$COMPANY_B_TOKEN" != "" ]; then
    pass "Company B registered successfully"
    info "Company B ID: $COMPANY_B_ID"
    info "Company B Branch ID: $COMPANY_B_BRANCH_ID"
else
    fail "Failed to register Company B"
fi

echo ""
info "Test 3: Verify companies are different"
if [ "$COMPANY_A_ID" != "$COMPANY_B_ID" ]; then
    pass "Company A and Company B have different IDs"
else
    fail "Company A and Company B have the same ID"
fi

echo ""
info "Test 4: Create student in Company A"
STUDENT_A_RESPONSE=$(curl -s -X POST "$API_URL/api/students" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"firstName\": \"StudentA\",
    \"lastName\": \"TestA\",
    \"parentName\": \"Parent A\",
    \"parentPhone\": \"1234567890\",
    \"branchId\": \"$COMPANY_A_BRANCH_ID\",
    \"enrollmentDate\": \"2024-01-01\"
  }")

STUDENT_A_ID=$(echo $STUDENT_A_RESPONSE | jq -r '.id')
STUDENT_A_COMPANY=$(echo $STUDENT_A_RESPONSE | jq -r '.companyId')

if [ "$STUDENT_A_ID" != "null" ] && [ "$STUDENT_A_ID" != "" ]; then
    pass "Student created in Company A"
    info "Student A ID: $STUDENT_A_ID"

    if [ "$STUDENT_A_COMPANY" == "$COMPANY_A_ID" ]; then
        pass "Student belongs to Company A"
    else
        fail "Student has wrong company ID"
    fi
else
    fail "Failed to create student in Company A"
fi

echo ""
info "Test 5: Create student in Company B"
STUDENT_B_RESPONSE=$(curl -s -X POST "$API_URL/api/students" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"firstName\": \"StudentB\",
    \"lastName\": \"TestB\",
    \"parentName\": \"Parent B\",
    \"parentPhone\": \"0987654321\",
    \"branchId\": \"$COMPANY_B_BRANCH_ID\",
    \"enrollmentDate\": \"2024-01-01\"
  }")

STUDENT_B_ID=$(echo $STUDENT_B_RESPONSE | jq -r '.id')
STUDENT_B_COMPANY=$(echo $STUDENT_B_RESPONSE | jq -r '.companyId')

if [ "$STUDENT_B_ID" != "null" ] && [ "$STUDENT_B_ID" != "" ]; then
    pass "Student created in Company B"
    info "Student B ID: $STUDENT_B_ID"

    if [ "$STUDENT_B_COMPANY" == "$COMPANY_B_ID" ]; then
        pass "Student belongs to Company B"
    else
        fail "Student has wrong company ID"
    fi
else
    fail "Failed to create student in Company B"
fi

echo ""
info "Test 6: Company A lists their students"
STUDENTS_A=$(curl -s -X GET "$API_URL/api/students" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN")

STUDENT_COUNT_A=$(echo $STUDENTS_A | jq '. | length')
CONTAINS_STUDENT_A=$(echo $STUDENTS_A | jq "any(.[]; .id == \"$STUDENT_A_ID\")")
CONTAINS_STUDENT_B=$(echo $STUDENTS_A | jq "any(.[]; .id == \"$STUDENT_B_ID\")")

if [ "$STUDENT_COUNT_A" == "1" ]; then
    pass "Company A sees exactly 1 student"
else
    fail "Company A sees $STUDENT_COUNT_A students, expected 1"
fi

if [ "$CONTAINS_STUDENT_A" == "true" ]; then
    pass "Company A can see their own student"
else
    fail "Company A cannot see their own student"
fi

if [ "$CONTAINS_STUDENT_B" == "false" ]; then
    pass "Company A CANNOT see Company B's student"
else
    fail "DATA LEAK: Company A can see Company B's student!"
fi

echo ""
info "Test 7: Company B lists their students"
STUDENTS_B=$(curl -s -X GET "$API_URL/api/students" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN")

STUDENT_COUNT_B=$(echo $STUDENTS_B | jq '. | length')
CONTAINS_STUDENT_A_B=$(echo $STUDENTS_B | jq "any(.[]; .id == \"$STUDENT_A_ID\")")
CONTAINS_STUDENT_B_B=$(echo $STUDENTS_B | jq "any(.[]; .id == \"$STUDENT_B_ID\")")

if [ "$STUDENT_COUNT_B" == "1" ]; then
    pass "Company B sees exactly 1 student"
else
    fail "Company B sees $STUDENT_COUNT_B students, expected 1"
fi

if [ "$CONTAINS_STUDENT_B_B" == "true" ]; then
    pass "Company B can see their own student"
else
    fail "Company B cannot see their own student"
fi

if [ "$CONTAINS_STUDENT_A_B" == "false" ]; then
    pass "Company B CANNOT see Company A's student"
else
    fail "DATA LEAK: Company B can see Company A's student!"
fi

echo ""
info "Test 8: Company B tries to access Company A's student by ID"
FORBIDDEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/api/students/$STUDENT_A_ID" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN")

HTTP_CODE=$(echo "$FORBIDDEN_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" == "404" ] || [ "$HTTP_CODE" == "403" ]; then
    pass "Company B denied access to Company A's student (HTTP $HTTP_CODE)"
else
    fail "SECURITY ISSUE: Company B can access Company A's student (HTTP $HTTP_CODE)"
fi

echo ""
info "Test 9: Company A can access their own student by ID"
OWN_STUDENT=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/api/students/$STUDENT_A_ID" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN")

HTTP_CODE_OWN=$(echo "$OWN_STUDENT" | tail -n 1)
STUDENT_DATA=$(echo "$OWN_STUDENT" | head -n -1)
RETRIEVED_COMPANY=$(echo "$STUDENT_DATA" | jq -r '.companyId')

if [ "$HTTP_CODE_OWN" == "200" ]; then
    pass "Company A can access their own student (HTTP $HTTP_CODE_OWN)"

    if [ "$RETRIEVED_COMPANY" == "$COMPANY_A_ID" ]; then
        pass "Retrieved student belongs to Company A"
    else
        fail "Retrieved student has wrong company ID"
    fi
else
    fail "Company A cannot access their own student (HTTP $HTTP_CODE_OWN)"
fi

echo ""
info "Test 10: Test branches isolation"
BRANCHES_A=$(curl -s -X GET "$API_URL/api/branches" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN")

BRANCHES_B=$(curl -s -X GET "$API_URL/api/branches" \
  -H "Authorization: Bearer $COMPANY_B_TOKEN")

BRANCH_COUNT_A=$(echo $BRANCHES_A | jq '. | length')
BRANCH_COUNT_B=$(echo $BRANCHES_B | jq '. | length')

if [ "$BRANCH_COUNT_A" == "1" ] && [ "$BRANCH_COUNT_B" == "1" ]; then
    pass "Each company sees only their own branch"
else
    fail "Branch isolation issue: Company A sees $BRANCH_COUNT_A, Company B sees $BRANCH_COUNT_B"
fi

echo ""
info "Test 11: Verify JWT tokens contain companyId"
PROFILE_A=$(curl -s -X GET "$API_URL/api/auth/profile" \
  -H "Authorization: Bearer $COMPANY_A_TOKEN")

PROFILE_COMPANY_ID=$(echo $PROFILE_A | jq -r '.companyId')

if [ "$PROFILE_COMPANY_ID" == "$COMPANY_A_ID" ]; then
    pass "JWT token contains correct companyId"
else
    fail "JWT token missing or incorrect companyId"
fi

echo ""
info "Test 12: Test old token format rejected"
# Create a fake token without companyId (this should fail)
OLD_TOKEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/api/auth/profile" \
  -H "Authorization: Bearer invalid.old.token")

OLD_TOKEN_HTTP=$(echo "$OLD_TOKEN_RESPONSE" | tail -n 1)

if [ "$OLD_TOKEN_HTTP" == "401" ]; then
    pass "Old token format correctly rejected"
else
    fail "Old token format not properly rejected (HTTP $OLD_TOKEN_HTTP)"
fi

echo ""
echo "================================================"
echo -e "${GREEN}ALL TESTS PASSED!${NC}"
echo "Multi-tenant isolation is working correctly."
echo ""
info "Cleanup: Delete test data if needed"
info "Company A ID: $COMPANY_A_ID"
info "Company B ID: $COMPANY_B_ID"
info "Student A ID: $STUDENT_A_ID"
info "Student B ID: $STUDENT_B_ID"
