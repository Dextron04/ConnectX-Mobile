# ConnectX Mobile - React Native Wrapper

A React Native mobile wrapper for the ConnectX chat application. This app provides a native mobile interface to connect to your ConnectX server.

## Features

- 📱 Native iOS app interface
- 🔐 User authentication (login/register)
- 💬 Real-time chat with Socket.IO
- 🔔 **Push notifications for new messages**
- ⚙️ Server configuration settings
- 🔄 Automatic reconnection
- 📨 Message history and conversations
- 🔕 **Notification settings and preferences**
- 🎨 Clean, modern UI

## Prerequisites

Before running this app, make sure you have:

1. **Node.js** (v16 or newer)
2. **npm** or **yarn**
3. **Expo CLI** (`npm install -g @expo/cli`)
4. **ConnectX Server** running (the main application this wrapper connects to)
5. **iOS Simulator** (for iOS development) or **Expo Go** app on your device

## Setup

1. **Clone and navigate to the project:**
   ```bash
   cd ConnectX-Mobile/ConnectXMobile
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up push notifications (Server):**
   ```bash
   # Install Expo server SDK in your ConnectX server
   cd /path/to/ConnectX
   npm install expo-server-sdk
   ```
   
   Then follow the instructions in `server-integration/INTEGRATION.md` to integrate push notifications with your ConnectX server.

4. **Start the development server:**
   ```bash
   npm start
   # or
   npx expo start
   ```

5. **Run on iOS:**
   ```bash
   npm run ios
   # or
   npx expo start --ios
   ```

## Configuration

### Server Connection

When you first open the app, you'll need to configure the server connection:

1. The app will open to the **Settings** screen
2. Enter your ConnectX server URL (e.g., `localhost:3000` or `your-server.com`)
3. Toggle **Use HTTPS** if your server uses SSL/TLS
4. Tap **Save & Test Connection**
5. If successful, tap **Continue** to proceed to login

### Development Server

For local development, ensure your ConnectX server is running:

```bash
cd /path/to/ConnectX
npm run dev
```

The server should be accessible at `http://localhost:3000` by default.

## Usage

### Initial Setup
1. **Configure Server**: Set your ConnectX server URL in Settings
2. **Create Account**: Register a new account or login with existing credentials
3. **Start Chatting**: Select conversations and send messages

### Navigation
- **Settings Button**: Access server configuration (available in chat screen)
- **Back Button**: Return to previous screen
- **Logout Button**: Sign out and return to login screen

### Features

#### Authentication
- **Login**: Enter email and password
- **Register**: Create new account with name, email, and password
- **Auto-login**: Remembers your session between app launches

#### Chat Interface
- **Conversations List**: View all your conversations with unread counts
- **Real-time Messages**: Instant message delivery via WebSocket
- **Message History**: Browse previous messages
- **Send Messages**: Type and send messages to conversations

#### Push Notifications 🔔
- **Message Notifications**: Get notified when you receive new messages
- **Permission Management**: Easy setup and permission handling
- **Notification Settings**: Control which notifications you receive
- **Sound & Vibration**: Customizable notification behavior
- **Test Notifications**: Verify your notification setup works

#### Settings
- **Server URL Configuration**: Change the ConnectX server endpoint
- **HTTPS Toggle**: Enable secure connections
- **Connection Testing**: Verify server connectivity
- **Connection Status**: View current connection state
- **Notification Preferences**: Manage all notification settings

## API Endpoints

The app connects to these ConnectX server endpoints:

- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration  
- `GET /api/auth/me` - Get current user info
- `GET /api/conversations` - List conversations
- `GET /api/conversations/:id/messages` - Get conversation messages
- `POST /api/messages` - Send new message
- `WebSocket` - Real-time communication

## File Structure

```
src/
├── contexts/
│   └── AuthContext.tsx          # Authentication state management
├── screens/
│   ├── LoginScreen.tsx          # Login/register interface
│   ├── ChatScreen.tsx           # Main chat interface
│   └── SettingsScreen.tsx       # Server configuration
├── services/
│   ├── api.ts                   # HTTP API client
│   └── socket.ts                # WebSocket client
App.tsx                          # Main app with navigation
app.json                         # Expo configuration
```

## Development

### Key Components

1. **AuthContext**: Manages user authentication state
2. **API Service**: Handles HTTP requests to ConnectX server
3. **Socket Service**: Manages WebSocket connections for real-time features
4. **Navigation**: Stack-based navigation between screens

### Adding Features

To extend the app:

1. **New API Endpoints**: Add methods to `src/services/api.ts`
2. **New Screens**: Create in `src/screens/` and add to navigation
3. **Real-time Events**: Add socket listeners in `src/services/socket.ts`
4. **UI Components**: Follow existing styling patterns

## Building for Production

### iOS Build

1. **Configure Expo:**
   ```bash
   npx expo install expo-dev-client
   ```

2. **Build for iOS:**
   ```bash
   npx expo build:ios
   ```

3. **Or use EAS Build:**
   ```bash
   npm install -g @expo/eas-cli
   eas build --platform ios
   ```

## Troubleshooting

### Connection Issues

1. **Can't connect to server:**
   - Verify server URL is correct
   - Check if ConnectX server is running
   - Try toggling HTTPS setting
   - Check network connectivity

2. **Login fails:**
   - Verify credentials are correct
   - Check server logs for authentication errors
   - Ensure user account exists on server

3. **Messages not loading:**
   - Check WebSocket connection status
   - Verify user has access to conversations
   - Check server logs for API errors

### Development Issues

1. **App won't start:**
   - Run `npm install` to ensure dependencies are installed
   - Clear Expo cache: `npx expo start -c`
   - Check Node.js version compatibility

2. **iOS Simulator not working:**
   - Ensure Xcode is installed and updated
   - Try resetting iOS Simulator
   - Check Expo CLI version

## Security Notes

- The app allows HTTP connections for local development (configured in `app.json`)
- For production, always use HTTPS connections
- Authentication tokens are stored securely in AsyncStorage
- Network security exceptions are configured for localhost development

## Support

For issues related to:
- **ConnectX Server**: Check the main ConnectX application documentation
- **React Native/Expo**: Refer to official Expo documentation
- **Mobile App**: Check this README or create an issue

## License

This mobile wrapper follows the same license as the main ConnectX application.