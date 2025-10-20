#!/bin/bash

# Marine IoT Test Runner Script
# This script sets up the test database and runs all Marine IoT tests

set -e  # Exit on error

echo "======================================"
echo "Marine IoT Test Suite"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env.test ]; then
    export $(cat .env.test | grep -v '^#' | xargs)
fi

# Default values
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER:-root}
DB_PASSWORD=${DB_PASSWORD:-}
DB_NAME=${DB_NAME:-viis_local_test}

echo "Test Database Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# Check if MySQL is running
echo -n "Checking MySQL connection... "
if mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo -e "${RED}Error: Cannot connect to MySQL${NC}"
    echo "Please check your MySQL server and credentials in .env.test"
    exit 1
fi

# Create test database if it doesn't exist
echo -n "Ensuring test database exists... "
mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;" > /dev/null 2>&1
echo -e "${GREEN}✓${NC}"

echo ""
echo "======================================"
echo "Running Tests"
echo "======================================"
echo ""

# Parse command line arguments
TEST_TYPE=${1:-all}

case $TEST_TYPE in
    unit)
        echo "Running Unit Tests only..."
        npm run test:marine:unit
        ;;
    integration)
        echo "Running Integration Tests only..."
        npm run test:marine:integration
        ;;
    coverage)
        echo "Running All Tests with Coverage..."
        npm run test:marine:coverage
        ;;
    watch)
        echo "Running in Watch Mode..."
        npm run test:marine:watch
        ;;
    all|*)
        echo "Running All Marine IoT Tests..."
        npm run test:marine
        ;;
esac

TEST_EXIT_CODE=$?

echo ""
echo "======================================"
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All Tests Passed! ✓${NC}"
else
    echo -e "${RED}Some Tests Failed ✗${NC}"
fi
echo "======================================"

exit $TEST_EXIT_CODE
