/**
 * Server-side adapter for handling Expo push notifications
 * This file should be integrated into your ConnectX server
 * 
 * Place this in your ConnectX server's lib/ directory and modify
 * the push-notifications.ts file to use this adapter
 */

const { Expo } = require('expo-server-sdk');

class ExpoPushAdapter {
  constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN, // Optional for better rate limits
    });
  }

  /**
   * Check if a push token is an Expo push token
   */
  isExpoToken(token) {
    return Expo.isExpoPushToken(token);
  }

  /**
   * Send push notification via Expo
   */
  async sendExpoNotification(token, payload) {
    try {
      if (!this.isExpoToken(token)) {
        throw new Error('Invalid Expo push token');
      }

      const message = {
        to: token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        badge: payload.badge,
        ttl: 3600, // 1 hour
        priority: 'high',
        channelId: 'default',
      };

      // Add actions if provided (for iOS)
      if (payload.actions && payload.actions.length > 0) {
        message.categoryId = 'message-actions';
      }

      const chunk = this.expo.chunkPushNotifications([message]);
      const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk[0]);

      // Handle tickets and receipts
      const ticket = ticketChunk[0];
      if (ticket.status === 'error') {
        console.error('Expo push error:', ticket.message);
        return { success: false, error: ticket.message };
      }

      return { success: true, ticket: ticket };
    } catch (error) {
      console.error('Expo push notification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle push receipts (call this periodically to clean up failed tokens)
   */
  async handleReceipts(receiptIds) {
    try {
      const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);
      const receipts = [];

      for (const chunk of receiptIdChunks) {
        const receiptChunk = await this.expo.getPushNotificationReceiptsAsync(chunk);
        receipts.push(...Object.values(receiptChunk));
      }

      return receipts;
    } catch (error) {
      console.error('Error handling receipts:', error);
      return [];
    }
  }
}

module.exports = { ExpoPushAdapter };