#!/bin/bash

# Configuration
BASE_URL="http://localhost:7130/api/database/records/posts"
DURATION=600  # 5 minutes in seconds
CONCURRENT_REQUESTS=10  # Number of concurrent requests
REQUEST_INTERVAL=0.1  # Seconds between requests per thread

# Function to generate random 8-character string (macOS compatible)
generate_random_string() {
    # Use LC_ALL=C to avoid locale issues with tr on macOS
    LC_ALL=C cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 8
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Statistics
TOTAL_REQUESTS=0
SUCCESS_COUNT=0
ERROR_COUNT=0
NOT_MODIFIED_COUNT=0
ERROR_MESSAGES=""
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

# Create temp directory for logs
LOG_DIR="/tmp/postgrest-test-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# Create lock file for thread safety (macOS compatible)
LOCK_FILE="$LOG_DIR/lock"
touch "$LOCK_FILE"

echo "========================================="
echo "PostgREST Stability Test"
echo "========================================="
echo "Base URL: $BASE_URL"
echo "Duration: $DURATION seconds (5 minutes)"
echo "Concurrent requests: $CONCURRENT_REQUESTS"
echo "Request interval: $REQUEST_INTERVAL seconds"
echo "Log directory: $LOG_DIR"
echo "========================================="
echo ""

# Function to make requests
make_requests() {
    local thread_id=$1
    local log_file="$LOG_DIR/thread-$thread_id.log"
    
    while [ $(date +%s) -lt $END_TIME ]; do
        # Generate random 8-character string for query parameter
        RANDOM_STR=$(generate_random_string)
        URL="${BASE_URL}?title=eq.${RANDOM_STR}"
        
        # Make request and capture response (macOS compatible)
        RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}\n:TIME:%{time_total}" "$URL" 2>&1)
        HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
        RESPONSE_TIME=$(echo "$RESPONSE" | grep ":TIME:" | cut -d: -f3)
        RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d' | sed '/^:TIME:/d')
        
        # Update global counters (using simple file-based locking for macOS)
        while ! mkdir "$LOCK_FILE.lock" 2>/dev/null; do
            sleep 0.01
        done
        
        # Read current values
        [ -f "$LOG_DIR/total.cnt" ] && TOTAL_REQUESTS=$(cat "$LOG_DIR/total.cnt") || TOTAL_REQUESTS=0
        [ -f "$LOG_DIR/success.cnt" ] && SUCCESS_COUNT=$(cat "$LOG_DIR/success.cnt") || SUCCESS_COUNT=0
        [ -f "$LOG_DIR/error.cnt" ] && ERROR_COUNT=$(cat "$LOG_DIR/error.cnt") || ERROR_COUNT=0
        [ -f "$LOG_DIR/not_modified.cnt" ] && NOT_MODIFIED_COUNT=$(cat "$LOG_DIR/not_modified.cnt") || NOT_MODIFIED_COUNT=0
        
        TOTAL_REQUESTS=$((TOTAL_REQUESTS + 1))
        
        if [ "$HTTP_CODE" = "200" ]; then
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Thread $thread_id: SUCCESS (${RESPONSE_TIME}s)" >> "$log_file"
        elif [ "$HTTP_CODE" = "304" ]; then
            NOT_MODIFIED_COUNT=$((NOT_MODIFIED_COUNT + 1))
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Thread $thread_id: NOT MODIFIED (${RESPONSE_TIME}s)" >> "$log_file"
        else
            ERROR_COUNT=$((ERROR_COUNT + 1))
            ERROR_MSG="[$(date '+%Y-%m-%d %H:%M:%S')] Thread $thread_id: ERROR - HTTP $HTTP_CODE (${RESPONSE_TIME}s)"
            echo "$ERROR_MSG" >> "$log_file"
            echo "Response: $RESPONSE_BODY" >> "$log_file"
            echo -e "${RED}$ERROR_MSG${NC}"
            
            # Log error details to main error file
            echo "$ERROR_MSG" >> "$LOG_DIR/errors.log"
            echo "Response: $RESPONSE_BODY" >> "$LOG_DIR/errors.log"
            echo "---" >> "$LOG_DIR/errors.log"
        fi
        
        # Update counter files
        echo $TOTAL_REQUESTS > "$LOG_DIR/total.cnt"
        echo $SUCCESS_COUNT > "$LOG_DIR/success.cnt"
        echo $ERROR_COUNT > "$LOG_DIR/error.cnt"
        echo $NOT_MODIFIED_COUNT > "$LOG_DIR/not_modified.cnt"
        
        # Release lock
        rmdir "$LOCK_FILE.lock" 2>/dev/null
        
        sleep $REQUEST_INTERVAL
    done
}

# Function to display statistics
display_stats() {
    while [ $(date +%s) -lt $END_TIME ]; do
        # Read current values
        [ -f "$LOG_DIR/total.cnt" ] && TOTAL_REQUESTS=$(cat "$LOG_DIR/total.cnt")
        [ -f "$LOG_DIR/success.cnt" ] && SUCCESS_COUNT=$(cat "$LOG_DIR/success.cnt")
        [ -f "$LOG_DIR/error.cnt" ] && ERROR_COUNT=$(cat "$LOG_DIR/error.cnt")
        [ -f "$LOG_DIR/not_modified.cnt" ] && NOT_MODIFIED_COUNT=$(cat "$LOG_DIR/not_modified.cnt")
        
        ELAPSED=$(($(date +%s) - START_TIME))
        REMAINING=$((END_TIME - $(date +%s)))
        
        if [ $TOTAL_REQUESTS -gt 0 ]; then
            SUCCESS_RATE=$(echo "scale=2; $SUCCESS_COUNT * 100 / $TOTAL_REQUESTS" | bc)
            REQ_PER_SEC=$(echo "scale=2; $TOTAL_REQUESTS / $ELAPSED" | bc)
        else
            SUCCESS_RATE=0
            REQ_PER_SEC=0
        fi
        
        # Clear line and print stats
        printf "\r${GREEN}[%ds/%ds]${NC} Requests: %d | Success: %d (%.1f%%) | 304s: %d | Errors: %d | Rate: %.1f req/s | Remaining: %ds" \
            "$ELAPSED" "$DURATION" "$TOTAL_REQUESTS" "$SUCCESS_COUNT" "$SUCCESS_RATE" "$NOT_MODIFIED_COUNT" "$ERROR_COUNT" "$REQ_PER_SEC" "$REMAINING"
        
        sleep 1
    done
}

# Start concurrent request threads
echo "Starting $CONCURRENT_REQUESTS concurrent request threads..."
for i in $(seq 1 $CONCURRENT_REQUESTS); do
    make_requests $i &
    PIDS[$i]=$!
done

# Start statistics display
display_stats &
STATS_PID=$!

# Wait for all threads to complete
for pid in ${PIDS[@]}; do
    wait $pid
done

# Kill stats display
kill $STATS_PID 2>/dev/null

# Final statistics
echo ""
echo ""
echo "========================================="
echo "Test Complete - Final Statistics"
echo "========================================="
echo "Total Requests: $TOTAL_REQUESTS"
echo -e "Successful: ${GREEN}$SUCCESS_COUNT${NC}"
echo -e "Not Modified (304): ${YELLOW}$NOT_MODIFIED_COUNT${NC}"
echo -e "Failed: ${RED}$ERROR_COUNT${NC}"

if [ $TOTAL_REQUESTS -gt 0 ]; then
    SUCCESS_RATE=$(echo "scale=2; $SUCCESS_COUNT * 100 / $TOTAL_REQUESTS" | bc)
    echo "Success Rate: $SUCCESS_RATE%"
    AVG_REQ_PER_SEC=$(echo "scale=2; $TOTAL_REQUESTS / $DURATION" | bc)
    echo "Average Rate: $AVG_REQ_PER_SEC requests/second"
fi

echo "========================================="

# Check for errors
if [ $ERROR_COUNT -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Errors detected! Check the following files for details:${NC}"
    echo "  - Error log: $LOG_DIR/errors.log"
    echo "  - Thread logs: $LOG_DIR/thread-*.log"
    echo ""
    echo "First 10 errors:"
    head -n 20 "$LOG_DIR/errors.log" 2>/dev/null || echo "No error details available"
else
    echo ""
    echo -e "${GREEN}✓ No errors detected during the test!${NC}"
fi

echo ""
echo "Full logs available at: $LOG_DIR"