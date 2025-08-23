import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectXAPI } from './api';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushNotificationData {
  conversationId?: string;
  messageId?: string;
  senderId?: string;
  url?: string;
  [key: string]: any;
}

export interface NotificationContent {
  title: string;
  body: string;
  data?: PushNotificationData;
}

class NotificationService {
  private token: string | null = null;
  private isRegistered: boolean = false;

  async initialize() {
    try {
      // Check if device supports push notifications
      if (!Device.isDevice) {
        console.warn('Push notifications only work on physical devices');
        return false;
      }

      // Register for push notifications
      const success = await this.registerForPushNotificationsAsync();
      if (success) {
        // Subscribe to server if we have a token
        await this.subscribeToServer();
      }

      // Set up notification listeners
      this.setupNotificationListeners();

      return success;
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
      return false;
    }
  }

  private async registerForPushNotificationsAsync(): Promise<boolean> {
    try {
      // Check existing permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Ask for permission if not granted
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Failed to get push token for push notification');
        return false;
      }

      // Get the push token
      // For development, we can get a token without a specific project ID
      // In production, you'll need a proper Expo project ID
      let tokenData;

      try {
        // First try with project ID if available
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ||
          Constants.manifest?.extra?.eas?.projectId ||
          Constants.manifest2?.extra?.eas?.projectId;

        if (projectId && projectId !== 'your-project-id-here') {
          console.log('Using project ID:', projectId);
          tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        } else {
          // Fallback: get token without project ID (works in development)
          console.log('Getting push token without project ID (development mode)');
          tokenData = await Notifications.getExpoPushTokenAsync();
        }
      } catch (error) {
        // If project ID fails, try without it
        console.warn('Failed to get token with project ID, trying without:', error);
        tokenData = await Notifications.getExpoPushTokenAsync();
      }

      this.token = tokenData.data;
      await AsyncStorage.setItem('expo_push_token', this.token);
      console.log('Push notification token:', this.token);

      // Configure notification channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'ConnectX Messages',
          description: 'Notifications for new messages in ConnectX',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#3b82f6',
          sound: 'default',
        });
      }

      this.isRegistered = true;
      return true;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return false;
    }
  }

  private setupNotificationListeners() {
    // Handle notifications received while app is in foreground
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
      this.handleNotificationReceived(notification);
    });

    // Handle notification taps
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification tapped:', response);
      this.handleNotificationResponse(response);
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }

  private handleNotificationReceived(notification: Notifications.Notification) {
    const data = notification.request.content.data as PushNotificationData;

    // You can add custom logic here for handling received notifications
    // For example, update unread counts, refresh conversations, etc.

    if (data?.conversationId) {
      // Could emit an event to update the conversation list
      console.log('Message notification for conversation:', data.conversationId);
    }
  }

  private handleNotificationResponse(response: Notifications.NotificationResponse) {
    const data = response.notification.request.content.data as PushNotificationData;

    // Handle navigation based on notification data
    if (data?.conversationId) {
      // Could navigate to specific conversation
      console.log('Navigate to conversation:', data.conversationId);
    }
  }

  async subscribeToServer(): Promise<boolean> {
    try {
      if (!this.token) {
        console.warn('No push token available for server subscription');
        return false;
      }

      // For Expo push notifications, we create a custom subscription format
      // that the server can understand and convert to VAPID format if needed
      const subscription = {
        endpoint: `https://exp.host/--/api/v2/push/send`,
        keys: {
          // Expo push tokens don't use VAPID keys, but we need to provide them
          // The server will need to handle Expo tokens differently
          p256dh: 'expo-token',  // Placeholder
          auth: this.token       // Store Expo token in auth field
        }
      };

      const response = await connectXAPI.subscribeToNotifications(subscription);
      console.log('Subscribed to server notifications:', response);

      await AsyncStorage.setItem('notification_subscribed', 'true');
      return true;
    } catch (error) {
      console.error('Failed to subscribe to server notifications:', error);
      return false;
    }
  }

  async unsubscribeFromServer(): Promise<boolean> {
    try {
      if (!this.token) {
        return true; // Nothing to unsubscribe
      }

      const endpoint = `https://exp.host/--/api/v2/push/send`;
      await connectXAPI.unsubscribeFromNotifications(endpoint);

      await AsyncStorage.removeItem('notification_subscribed');
      await AsyncStorage.removeItem('expo_push_token');

      this.token = null;
      this.isRegistered = false;

      console.log('Unsubscribed from server notifications');
      return true;
    } catch (error) {
      console.error('Failed to unsubscribe from server notifications:', error);
      return false;
    }
  }

  async scheduleLocalNotification(content: NotificationContent) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          body: content.body,
          data: content.data || {},
          sound: 'default',
        },
        trigger: null, // Show immediately
      });
    } catch (error) {
      console.error('Failed to schedule local notification:', error);
    }
  }

  async clearAllNotifications() {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  }

  async getBadgeCount(): Promise<number> {
    try {
      return await Notifications.getBadgeCountAsync();
    } catch (error) {
      console.error('Failed to get badge count:', error);
      return 0;
    }
  }

  async setBadgeCount(count: number) {
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      console.error('Failed to set badge count:', error);
    }
  }

  getToken(): string | null {
    return this.token;
  }

  isRegisteredForNotifications(): boolean {
    return this.isRegistered;
  }

  // Check if notifications are enabled in device settings
  async checkPermissions(): Promise<{
    granted: boolean;
    status: string;
    canAskAgain: boolean;
  }> {
    try {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      return {
        granted: status === 'granted',
        status,
        canAskAgain
      };
    } catch (error) {
      console.error('Failed to check notification permissions:', error);
      return { granted: false, status: 'unknown', canAskAgain: false };
    }
  }

  // Request permissions again if possible
  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Failed to request notification permissions:', error);
      return false;
    }
  }
}

export const notificationService = new NotificationService();