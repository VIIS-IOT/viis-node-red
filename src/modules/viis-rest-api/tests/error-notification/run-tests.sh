#!/bin/bash

# Error Notification API Test Runner
# Quick script to run tests with proper setup

set -e

echo "🧪 Error Notification API Test Runner"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running from correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from project root directory${NC}"
    echo "   cd /services/nodered/custom-nodes/viis-node-red"
    exit 1
fi

echo "📦 Checking dependencies..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Installing dependencies...${NC}"
    npm install
fi

# Check database connection
echo ""
echo "🔍 Checking database connection..."
if command -v mysql &> /dev/null; then
    if mysql -h localhost -P 3308 -u admin -padmin@123 viis_local -e "SELECT 1" &> /dev/null; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
    else
        echo -e "${RED}❌ Cannot connect to database${NC}"
        echo "   Please ensure MySQL is running:"
        echo "   docker ps | grep mysql"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  mysql client not found, skipping database check${NC}"
fi

# Check Node-RED server
echo ""
echo "🔍 Checking Node-RED server..."
if curl -s http://localhost:1881 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Node-RED server is running${NC}"
else
    echo -e "${YELLOW}⚠️  Node-RED server may not be running${NC}"
    echo "   Integration tests may fail"
fi

# Build if needed
echo ""
echo "🔨 Building project..."
npm run build

# Run tests based on argument
echo ""
echo "🚀 Running tests..."
echo ""

case "${1:-all}" in
    "unit")
        echo "Running unit tests only..."
        npm run test:error-notification:unit
        ;;
    "integration")
        echo "Running integration tests only..."
        npm run test:error-notification:integration
        ;;
    "coverage")
        echo "Running tests with coverage..."
        npm run test:error-notification:coverage
        ;;
    "watch")
        echo "Running tests in watch mode..."
        npm run test:error-notification:watch
        ;;
    "all"|*)
        echo "Running all error notification tests..."
        npm run test:error-notification
        ;;
esac

echo ""
echo -e "${GREEN}✅ Tests completed!${NC}"
