// Stub refund service for demo
export interface RefundResult {
  refundId: string;
  amount: number;
  customerEmail: string;
  orderId: string;
}

export interface RefundHistoryItem {
  refundId: string;
  amount: number;
  date: string;
  adminId: string;
}

export class RefundService {
  async processRefund(orderId: string, amount: number): Promise<RefundResult> {
    return {
      refundId: `refund-${Date.now()}`,
      amount,
      customerEmail: "customer@example.com",
      orderId,
    };
  }

  async getHistory(orderId: string): Promise<RefundHistoryItem[]> {
    return [
      {
        refundId: "refund-001",
        amount: 50.00,
        date: "2025-01-29",
        adminId: "admin-001",
      },
    ];
  }
}
