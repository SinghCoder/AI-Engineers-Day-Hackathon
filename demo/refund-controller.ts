import { Request, Response } from "express";
import { verifyJWT, getUserFromToken } from "./auth";
import { RefundService } from "./refund-service";
import { logger } from "./logger";

const MAX_REFUND_AMOUNT = 10000;

/**
 * Controller for processing refunds
 * 
 * INTENTS:
 * - Only admins can process refunds
 * - Must validate JWT on every request
 * - No PII in logs
 * - Max refund $10,000
 */
export class RefundController {
  private refundService: RefundService;

  constructor() {
    this.refundService = new RefundService();
  }

  /**
   * Process a refund request
   */
  async processRefund(req: Request, res: Response): Promise<void> {
    try {
      // Extract and validate JWT
      const token = req.headers.authorization?.split(" ")[1];
      
      if (!token) {
        res.status(401).json({ error: "No authorization token provided" });
        return;
      }

      const payload = await verifyJWT(token);
      if (!payload) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      const user = await getUserFromToken(payload);

      // BUG: This violates the "admin-only" intent!
      // Support role was added without updating the intent
      if (user.role !== "admin" && user.role !== "support") {
        res.status(403).json({ error: "Only admins can process refunds" });
        return;
      }

      const { orderId, amount, reason } = req.body;

      // Validate amount
      if (amount > MAX_REFUND_AMOUNT) {
        res.status(400).json({ 
          error: `Refund amount exceeds maximum of $${MAX_REFUND_AMOUNT}` 
        });
        return;
      }

      // Process the refund
      const result = await this.refundService.processRefund(orderId, amount);

      // BUG: This logs PII (customer email) - violates the "no PII in logs" intent!
      logger.info(`Refund processed: order=${orderId}, amount=${amount}, customer=${result.customerEmail}, admin=${user.id}`);

      res.json({
        success: true,
        refundId: result.refundId,
        amount: result.amount,
      });

    } catch (error) {
      logger.error("Refund processing failed", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Get refund history for an order
   */
  async getRefundHistory(req: Request, res: Response): Promise<void> {
    const token = req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      res.status(401).json({ error: "No authorization token" });
      return;
    }

    // BUG: No JWT validation here - violates "validate JWT on every request" intent!
    const { orderId } = req.params;
    
    const history = await this.refundService.getHistory(orderId);
    res.json(history);
  }
}
