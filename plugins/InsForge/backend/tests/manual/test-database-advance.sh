#!/bin/bash

# Test script for database advance functionality
# Tests rawSQL, export, and import operations

# Configuration
BASE_URL="http://localhost:7130/api/database/advance"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwicm9sZSI6InByb2plY3RfYWRtaW4iLCJpYXQiOjE3NTY0MDM2NTUsImV4cCI6MTc1NzAwODQ1NX0.UhLvS5f4vdzsR0bZLmHvQ-MX6WPoPieTZ4H7sxjRYGM"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "Database Advance Operations Test Script"
echo "========================================="
echo "Base URL: $BASE_URL"
echo "Testing rawSQL, export, and import operations..."
echo "========================================="
echo ""

# Function to test rawSQL endpoint
test_rawsql() {
    local test_name="$1"
    local request_body="$2"
    local description="$3"
    
    echo -e "${BLUE}Test: $test_name${NC}"
    echo -e "${YELLOW}Description: $description${NC}"
    echo "Request body: $request_body"
    echo ""
    
    # Make the API request
    RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}" -X POST "$BASE_URL/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "$request_body" 2>&1)
    
    # Extract HTTP code and response body
    HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d')
    
    echo -e "${BLUE}HTTP Status: $HTTP_CODE${NC}"
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Request successful${NC}"
        echo ""
        echo -e "${BLUE}Response:${NC}"
        echo "$RESPONSE_BODY" | jq . 2>/dev/null || echo "$RESPONSE_BODY"
    else
        echo -e "${RED}✗ Request failed${NC}"
        echo ""
        echo -e "${RED}Response:${NC}"
        echo "$RESPONSE_BODY"
    fi
    
    echo ""
    echo "----------------------------------------"
    echo ""
}

# Function to make API request and show results
test_export() {
    local test_name="$1"
    local request_body="$2"
    local description="$3"
    
    echo -e "${BLUE}Test: $test_name${NC}"
    echo -e "${YELLOW}Description: $description${NC}"
    echo "Request body: $request_body"
    echo ""
    
    # Make the API request
    RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}" -X POST "$BASE_URL/export" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "$request_body" 2>&1)
    
    # Extract HTTP code and response body
    HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d')
    
    echo -e "${BLUE}HTTP Status: $HTTP_CODE${NC}"
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Request successful${NC}"
        echo ""
        echo -e "${BLUE}Response:${NC}"
        echo "$RESPONSE_BODY" | jq . 2>/dev/null || echo "$RESPONSE_BODY"
    else
        echo -e "${RED}✗ Request failed${NC}"
        echo ""
        echo -e "${RED}Response:${NC}"
        echo "$RESPONSE_BODY"
    fi
    
    echo ""
    echo "----------------------------------------"
    echo ""
}

# Function to test import endpoint with file upload
test_import() {
    local test_name="$1"
    local file_path="$2"
    local truncate_option="$3"
    local description="$4"
    
    echo -e "${BLUE}Test: $test_name${NC}"
    echo -e "${YELLOW}Description: $description${NC}"
    echo "File: $file_path"
    echo "Truncate: $truncate_option"
    echo ""
    
    # Check if file exists
    if [ ! -f "$file_path" ]; then
        echo -e "${RED}✗ File not found: $file_path${NC}"
        echo ""
        echo "----------------------------------------"
        echo ""
        return 1
    fi
    
    # Make the API request with file upload
    RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}" -X POST "$BASE_URL/import" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@$file_path" \
        -F "truncate=$truncate_option" 2>&1)
    
    # Extract HTTP code and response body
    HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d')
    
    echo -e "${BLUE}HTTP Status: $HTTP_CODE${NC}"
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Request successful${NC}"
        echo ""
        echo -e "${BLUE}Response:${NC}"
        echo "$RESPONSE_BODY" | jq . 2>/dev/null || echo "$RESPONSE_BODY"
    else
        echo -e "${RED}✗ Request failed${NC}"
        echo ""
        echo -e "${RED}Response:${NC}"
        echo "$RESPONSE_BODY"
    fi
    
    echo ""
    echo "----------------------------------------"
    echo ""
}

# ===========================================
# RAW SQL TESTS
# ===========================================

echo -e "${GREEN}=== RAW SQL TESTS ===${NC}"
echo ""

# Test 1: Check if posts table exists
test_rawsql \
    "Check Posts Table Existence" \
    '{"query": "SELECT tablename FROM pg_tables WHERE schemaname = '\''public'\'' AND tablename = '\''posts'\'';"}' \
    "Verify that the posts table exists before creating index"

# Test 2: Check existing indexes on posts table
test_rawsql \
    "Check Existing Indexes on Posts" \
    '{"query": "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '\''posts'\'';"}' \
    "List all existing indexes on the posts table"

# Test 3: Create index on posts.title column
test_rawsql \
    "Create Title Index on Posts" \
    '{"query": "CREATE INDEX IF NOT EXISTS idx_posts_title ON posts(title);"}' \
    "Create an index on the title column of the posts table for better query performance"

# Test 4: Verify the index was created
test_rawsql \
    "Verify Title Index Creation" \
    '{"query": "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '\''posts'\'' AND indexname = '\''idx_posts_title'\'';"}' \
    "Confirm that the title index was successfully created"

# Test 5: Test a simple SELECT query
test_rawsql \
    "Simple Select Query" \
    '{"query": "SELECT COUNT(*) as total_posts FROM posts;"}' \
    "Count total number of posts in the table"

echo -e "${GREEN}=== EXPORT TESTS ===${NC}"
echo ""

# Test 6: Export users table in SQL format with data
test_export \
    "Users Table - SQL with Data" \
    '{"tables": ["users"], "format": "sql", "includeData": true}' \
    "Export users table as SQL with both schema and data"

# Test 7: Export users table in SQL format without data (schema only)
test_export \
    "Users Table - SQL Schema Only" \
    '{"tables": ["users"], "format": "sql", "includeData": false}' \
    "Export users table as SQL with schema only, no data"

# Test 8: Export users table in JSON format with data
test_export \
    "Users Table - JSON with Data" \
    '{"tables": ["users"], "format": "json", "includeData": true}' \
    "Export users table as JSON with both schema and data"

# Test 9: Export users table in JSON format without data (schema only)
test_export \
    "Users Table - JSON Schema Only" \
    '{"tables": ["users"], "format": "json", "includeData": false}' \
    "Export users table as JSON with schema only, no data"

# Test 10: Export all tables in SQL format (default behavior)
test_export \
    "All Tables - SQL Format" \
    '{"format": "sql"}' \
    "Export all tables as SQL with default settings"

# Test 11: Test with invalid table name
test_export \
    "Invalid Table Name" \
    '{"tables": ["nonexistent_table"], "format": "sql"}' \
    "Test error handling with non-existent table"

# Test 12: Test with invalid format
test_export \
    "Invalid Format" \
    '{"tables": ["users"], "format": "xml"}' \
    "Test validation with invalid format"

# Test 12.5: Export posts table in SQL format with data
test_export \
    "All Tables - SQL with Data" \
    '{"format": "sql", "includeData": false}' \
    "Export all tables as SQL with both schema and data"

echo -e "${GREEN}=== IMPORT TESTS ===${NC}"
echo ""

# Define the path to the SQL file
SQL_FILE_PATH="$(dirname "$0")/test-users.sql"

# Test 13: Import users.sql without truncate
test_import \
    "Import Users SQL - No Truncate" \
    "$SQL_FILE_PATH" \
    "false" \
    "Import users table structure from SQL file without truncating existing data"

# Test 14: Import users.sql with truncate
test_import \
    "Import Users SQL - With Truncate" \
    "$SQL_FILE_PATH" \
    "true" \
    "Import users table structure from SQL file with truncating existing data"

# Test 15: Test with non-existent file
test_import \
    "Import Non-existent File" \
    "$(dirname "$0")/nonexistent.sql" \
    "false" \
    "Test error handling with non-existent SQL file"

echo "========================================="
echo "Database Advance Tests Complete"
echo "========================================="
echo ""
echo -e "${GREEN}All tests have been executed.${NC}"
echo "Check the responses above to verify all functionality."
echo ""
echo "Key things to verify:"
echo ""
echo -e "${BLUE}Raw SQL Tests:${NC}"
echo "- Posts table existence check"
echo "- Index creation and verification"
echo "- SQL execution with proper responses"
echo ""
echo -e "${BLUE}Export Tests:${NC}"
echo "- SQL exports should contain CREATE TABLE statements"
echo "- When includeData=true, INSERT statements should be present"
echo "- When includeData=false, only schema should be exported"
echo "- JSON exports should have 'schema' and 'rows' properties"
echo "- Invalid requests should return appropriate error messages"
echo ""
echo -e "${BLUE}Import Tests:${NC}"
echo "- File uploads should be processed correctly"
echo "- SQL files should be executed and tables created"
echo "- Truncate option should control data preservation"
echo "- Error handling should work for missing files"
echo "- Response should include import statistics"