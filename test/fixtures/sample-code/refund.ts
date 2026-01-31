import { Request, Response } from "express";
import { verifyJWT } from "./auth";
import { User } from "./models";

/**
 * Process a refund for a customer
 */
export async function processRefund(req: Request, res: Response) {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const user = await verifyJWT(token);
  
  if (!user) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // BUG: This allows support role too, violating the admin-only intent!
  if (user.role === "admin" || user.role === "support") {
    const { amount, orderId } = req.body;
    
    // Process the refund
    console.log(`Processing refund of $${amount} for order ${orderId} by user ${user.email}`);
    
    await executeRefund(orderId, amount);
    
    return res.json({ success: true });
  }

  return res.status(403).json({ error: "Insufficient permissions" });
}

async function executeRefund(orderId: string, amount: number): Promise<void> {
  // Refund logic here
}
