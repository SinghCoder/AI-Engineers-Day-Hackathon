#!/bin/bash
# IntentMesh Hackathon Demo Setup
# Sets up scaffolding, then YOU use Cursor to generate the code

set -e

DEMO_DIR="${1:-$HOME/intentmesh-hackathon-demo}"

echo "🚀 IntentMesh Hackathon Demo Setup"
echo "   Location: $DEMO_DIR"
echo ""

# Clean up if exists
if [ -d "$DEMO_DIR" ]; then
  echo "⚠️  Directory exists. Removing..."
  rm -rf "$DEMO_DIR"
fi

mkdir -p "$DEMO_DIR/src"
cd "$DEMO_DIR"

# Initialize project
echo "📦 Initializing project scaffolding..."
cat > package.json << 'EOF'
{
  "name": "secure-payments-api",
  "version": "1.0.0",
  "description": "Payment processing API",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF

# Create empty placeholder files
touch src/types.ts
touch src/payments.ts
touch src/refunds.ts
touch src/index.ts

# Initialize git
git init -q
git add -A
git commit -q -m "Initial project scaffolding"

npm install --silent 2>/dev/null

echo ""
echo "✅ Project scaffolding complete!"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    DEMO FLOW"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "STEP 1: Open project in Cursor"
echo "  cursor $DEMO_DIR"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 2: Give Cursor this prompt (copy-paste):"
echo ""
cat << 'PROMPT'
Build a payment processing API in TypeScript with these requirements:

1. **Security**: Card PAN and CVV must NEVER be logged or stored in 
   plaintext - only masked versions (show last 4 digits of PAN, hide CVV)

2. **Fraud Prevention**: Payment amounts must be positive numbers - 
   reject any negative or zero amounts

3. **Compliance**: Refunds over $100 require a manager approval token

4. **Reliability**: All operations must be idempotent using a 
   client-provided idempotency key

Create:
- src/types.ts - Zod schemas for PaymentRequest, RefundRequest
- src/payments.ts - PaymentService with processPayment()
- src/refunds.ts - RefundService with processRefund()
- src/index.ts - Express server with /payments and /refunds endpoints

Keep the code clean and minimal - no excessive comments.
PROMPT
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 3: After Cursor generates code, record the trace:"
echo "  cd $DEMO_DIR"
echo "  node /Users/singhcoder/intentmesh/out/write-trace.js ."
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 4: Capture intents in VS Code"
echo "  - Open IntentMesh extension (F5 from intentmesh repo)"
echo "  - Open $DEMO_DIR folder"
echo "  - Run 'IntentMesh: Analyze Changes'"
echo "  - Intents will be extracted from your ACTUAL Cursor conversation!"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 5: Create drift - NEW Cursor conversation:"
echo ""
cat << 'DRIFT_PROMPT'
Add debug logging to help troubleshoot payment failures.
When validation fails, log the full request object.
Also add a SKIP_APPROVAL env var to bypass refund checks in testing.
DRIFT_PROMPT
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 6: Detect the drift"
echo "  - Run 'IntentMesh: Analyze Changes' again"
echo "  - Should detect violations against captured intents!"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "STEP 7: Show legitimate policy change (Intent Update)"
echo "  - New Cursor prompt: 'Change refund threshold from \$100 to \$500'"
echo "  - Run Analyze → detects drift"
echo "  - Click 'Update Intent' to evolve the requirement"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
