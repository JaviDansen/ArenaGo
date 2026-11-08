export interface EmailDelivery {
  isAvailable(): boolean;
  sendVerification(email: string, token: string): Promise<void>;
}
