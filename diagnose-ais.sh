#!/bin/bash

echo "🔍 AIS Gateway Diagnostic Tool"
echo "========================================================================"
echo ""

AIS_HOST="192.168.20.246"
AIS_PORT="8899"

# 1. Check network connectivity
echo "1️⃣  Testing network connectivity..."
if ping -c 3 -W 2 $AIS_HOST > /dev/null 2>&1; then
    echo "   ✅ Host $AIS_HOST is reachable"
else
    echo "   ❌ Cannot reach $AIS_HOST"
    exit 1
fi
echo ""

# 2. Check if port is open (TCP)
echo "2️⃣  Testing TCP port $AIS_PORT..."
if timeout 3 bash -c "cat < /dev/null > /dev/tcp/$AIS_HOST/$AIS_PORT" 2>/dev/null; then
    echo "   ✅ TCP port $AIS_PORT is open"
    TCP_OPEN=true
else
    echo "   ❌ TCP port $AIS_PORT is closed or filtered"
    TCP_OPEN=false
fi
echo ""

# 3. Try netcat to see if data is coming
echo "3️⃣  Listening for data on TCP (5 seconds)..."
echo "   If data appears below, gateway is sending via TCP:"
echo "   ---"
timeout 5 nc -v $AIS_HOST $AIS_PORT 2>&1 | head -20
echo "   ---"
echo ""

# 4. Check UDP
echo "4️⃣  Checking UDP..."
echo "   Note: UDP test requires listening on port $AIS_PORT"
echo "   Run: node test-ais-udp.js"
echo ""

# 5. Recommendations
echo "📋 Recommendations:"
echo ""
if [ "$TCP_OPEN" = true ]; then
    echo "   ✅ TCP connection works. Try:"
    echo "      node test-ais-gateway.js"
    echo ""
    echo "   💡 Nếu kết nối được nhưng không có data:"
    echo "      - Gateway có thể đang idle (không có tàu)"
    echo "      - Gateway cần command để bắt đầu streaming"
    echo "      - Kiểm tra tài liệu của gateway model này"
else
    echo "   ⚠️  TCP không hoạt động. Thử:"
    echo "      - Kiểm tra IP và port có đúng không"
    echo "      - Kiểm tra firewall"
    echo "      - Thử UDP: node test-ais-udp.js"
fi
echo ""

# 6. Additional tools
echo "🔧 Additional debugging tools:"
echo "   - TCP: nc -v $AIS_HOST $AIS_PORT"
echo "   - UDP listen: nc -u -l $AIS_PORT"
echo "   - Packet capture: tcpdump -i any host $AIS_HOST"
echo ""
echo "========================================================================"
