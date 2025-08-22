# Server Integration Guide for Push Notifications

This guide explains how to integrate Expo push notifications with your ConnectX server.

## Step 1: Install Expo Server SDK

In your ConnectX server directory, install the Expo server SDK:

```bash
cd /path/to/ConnectX
npm install expo-server-sdk
```

## Step 2: Copy the Expo Push Adapter

Copy the `expo-push-adapter.js` file to your ConnectX server's `lib/` directory:

```bash
cp server-integration/expo-push-adapter.js /path/to/ConnectX/lib/
```

## Step 3: Modify push-notifications.ts

Update your `lib/push-notifications.ts` file to handle Expo tokens. Add this to the top:

```typescript
import { ExpoPushAdapter } from './expo-push-adapter';

const expoPushAdapter = new ExpoPushAdapter();
```

Then modify the `sendPushNotification` function to handle Expo tokens:

```typescript
export async function sendPushNotification(
  userId: string, 
  payload: NotificationPayload
): Promise<{ success: boolean; errors: string[] }> {
  try {
    console.log(`🔔 Attempting to send push notification to user: ${userId}`)
    
    // Get user's notification settings
    const settings = await prisma.notificationSettings.findUnique({
      where: { userId }
    })

    if (!settings?.pushEnabled || !settings?.messageNotifications) {
      return { success: false, errors: ['User has notifications disabled'] }
    }

    // Get user's push subscriptions
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId }
    })

    if (subscriptions.length === 0) {
      return { success: false, errors: ['No push subscriptions found'] }
    }

    const errors: string[] = []
    let successCount = 0

    // Send notification to all user's subscriptions
    for (const subscription of subscriptions) {
      try {
        // Check if this is an Expo token (stored in the auth field)
        if (subscription.p256dh === 'expo-token') {
          // This is an Expo push token
          const expoToken = subscription.auth
          const result = await expoPushAdapter.sendExpoNotification(expoToken, payload)
          
          if (result.success) {
            console.log(`🔔 Expo notification sent successfully to: ${expoToken}`)
            successCount++
          } else {
            console.error('Expo push error:', result.error)
            errors.push(`Expo token ${subscription.id}: ${result.error}`)
          }
        } else {
          // This is a VAPID subscription (web browser)
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          }

          const notificationPayload = JSON.stringify({
            title: payload.title,
            body: payload.body,
            icon: payload.icon || '/favicon.ico',
            badge: payload.badge || '/favicon.ico',
            image: payload.image,
            data: payload.data || {},
            actions: payload.actions || []
          })

          await webpush.sendNotification(pushSubscription, notificationPayload)
          console.log(`🔔 VAPID notification sent successfully to: ${subscription.endpoint.substring(0, 50)}...`)
          successCount++
        }
      } catch (error: any) {
        console.error('Push notification error:', error)
        
        // Remove invalid subscriptions
        if (error.statusCode === 410) {
          await prisma.pushSubscription.delete({
            where: { id: subscription.id }
          })
        }
        
        errors.push(`Subscription ${subscription.id}: ${error.message}`)
      }
    }

    return {
      success: successCount > 0,
      errors: errors
    }
  } catch (error: any) {
    console.error('Send push notification error:', error)
    return { success: false, errors: [error.message] }
  }
}
```

## Step 4: Update Environment Variables (Optional)

Add to your `.env` file for better rate limits:

```env
EXPO_ACCESS_TOKEN=your_expo_access_token_here
```

You can get an access token from the Expo CLI:

```bash
npx expo login
npx expo whoami --json
```

## Step 5: Test the Integration

1. Start your ConnectX server with the modifications
2. Launch the React Native app
3. Login and enable push notifications in the notification settings
4. Send a message from another user or use the test notification feature

## How It Works

### Mobile App Side

1. **Registration**: The app requests push notification permissions and gets an Expo push token
2. **Subscription**: It sends a subscription to the server with:
   - `endpoint`: Expo's push service URL
   - `keys.p256dh`: Set to "expo-token" (identifier)
   - `keys.auth`: The actual Expo push token

### Server Side

1. **Detection**: Server checks if `p256dh === 'expo-token'` to identify Expo tokens
2. **Routing**: 
   - Expo tokens → Use Expo SDK to send notifications
   - VAPID tokens → Use existing web-push library
3. **Delivery**: Notifications are sent through the appropriate service

## Database Schema

No changes are needed to your existing database schema. Expo tokens are stored using the existing `PushSubscription` table:

- `endpoint`: "https://exp.host/--/api/v2/push/send"
- `p256dh`: "expo-token"
- `auth`: The Expo push token
- `userId`: User ID as usual

## Troubleshooting

### Common Issues

1. **"Invalid Expo push token"**: Check that the token format is correct
2. **"Push notification credentials are misconfigured"**: Ensure Expo project is properly configured
3. **High error rates**: Check Expo status page and rate limits

### Debug Logging

Add this to see detailed logs:

```typescript
console.log('Subscription details:', {
  id: subscription.id,
  endpoint: subscription.endpoint,
  p256dh: subscription.p256dh,
  isExpo: subscription.p256dh === 'expo-token'
})
```

### Testing Expo Tokens

Use the Expo push tool to test tokens directly:

```bash
curl -H "Content-Type: application/json" -X POST "https://exp.host/--/api/v2/push/send" -d '{
  "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "title":"hello",
  "body": "world"
}'
```

## Production Considerations

1. **Rate Limits**: Expo has rate limits, use batching for multiple notifications
2. **Error Handling**: Implement proper retry logic for failed notifications
3. **Token Cleanup**: Regularly clean up invalid/expired tokens
4. **Monitoring**: Monitor notification success rates and errors

## Receipt Handling (Advanced)

For production apps, implement receipt handling to track delivery:

```typescript
// Store ticket IDs when sending notifications
const ticketResult = await expoPushAdapter.sendExpoNotification(token, payload)
if (ticketResult.success && ticketResult.ticket.id) {
  // Store ticket.id in database for later receipt checking
}

// Periodically check receipts
const receipts = await expoPushAdapter.handleReceipts(ticketIds)
// Process receipts to identify failed deliveries
```

This ensures reliable notification delivery and helps identify issues with specific devices or tokens.