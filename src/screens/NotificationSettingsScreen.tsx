import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { connectXAPI } from '../services/api';
import { notificationService } from '../services/notifications';

interface NotificationSettings {
  pushEnabled: boolean;
  messageNotifications: boolean;
  emailNotifications: boolean;
  soundEnabled: boolean;
}

export const NotificationSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [settings, setSettings] = useState<NotificationSettings>({
    pushEnabled: true,
    messageNotifications: true,
    emailNotifications: false,
    soundEnabled: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({
    granted: false,
    status: 'unknown',
    canAskAgain: false,
  });

  useEffect(() => {
    loadSettings();
    checkPermissions();
  }, []);

  const loadSettings = async () => {
    try {
      const serverSettings = await connectXAPI.getNotificationSettings();
      setSettings(serverSettings);
    } catch (error) {
      console.error('Failed to load notification settings:', error);
      Alert.alert('Error', 'Failed to load notification settings');
    } finally {
      setIsLoading(false);
    }
  };

  const checkPermissions = async () => {
    const permissions = await notificationService.checkPermissions();
    setPermissionStatus(permissions);
  };

  const updateSetting = async (key: keyof NotificationSettings, value: boolean) => {
    setIsSaving(true);
    
    try {
      // If enabling push notifications but permissions not granted, request them
      if (key === 'pushEnabled' && value && !permissionStatus.granted) {
        const granted = await notificationService.requestPermissions();
        if (!granted) {
          Alert.alert(
            'Permission Required',
            'Push notifications are disabled in your device settings. Please enable them in Settings > Notifications > ConnectX Mobile.'
          );
          setIsSaving(false);
          return;
        }
        await checkPermissions();
      }

      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);

      // Update server settings
      await connectXAPI.updateNotificationSettings({ [key]: value });

      // If disabling push notifications, unsubscribe from server
      if (key === 'pushEnabled' && !value) {
        await notificationService.unsubscribeFromServer();
      } else if (key === 'pushEnabled' && value) {
        // If enabling push notifications, subscribe to server
        await notificationService.subscribeToServer();
      }

      console.log(`Updated ${key} to ${value}`);
    } catch (error) {
      console.error(`Failed to update ${key}:`, error);
      Alert.alert('Error', `Failed to update notification settings`);
      
      // Revert the setting on error
      setSettings(prev => ({ ...prev, [key]: !value }));
    } finally {
      setIsSaving(false);
    }
  };

  const testNotification = async () => {
    try {
      if (!permissionStatus.granted) {
        Alert.alert(
          'Permission Required',
          'Please enable push notifications to test them.'
        );
        return;
      }

      await notificationService.scheduleLocalNotification({
        title: 'ConnectX Test',
        body: 'Push notifications are working! 🎉',
        data: { test: true },
      });

      Alert.alert('Test Sent', 'A test notification has been sent!');
    } catch (error) {
      console.error('Failed to send test notification:', error);
      Alert.alert('Error', 'Failed to send test notification');
    }
  };

  const openSystemSettings = () => {
    Alert.alert(
      'Open Settings',
      'Would you like to open system settings to enable notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Open Settings', 
          onPress: () => {
            // On iOS, this would typically open the settings app
            // For now, we'll just show instructions
            Alert.alert(
              'Enable Notifications',
              'Go to Settings > Notifications > ConnectX Mobile and enable notifications.'
            );
          }
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading notification settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>
          
          <View style={styles.permissionStatus}>
            <Text style={styles.permissionLabel}>Permission Status:</Text>
            <Text style={[
              styles.permissionValue, 
              permissionStatus.granted ? styles.permissionGranted : styles.permissionDenied
            ]}>
              {permissionStatus.granted ? 'Granted ✓' : 'Not Granted ✗'}
            </Text>
          </View>

          {!permissionStatus.granted && (
            <TouchableOpacity style={styles.enableButton} onPress={openSystemSettings}>
              <Text style={styles.enableButtonText}>Enable in System Settings</Text>
            </TouchableOpacity>
          )}

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Enable Push Notifications</Text>
              <Text style={styles.settingDescription}>
                Receive push notifications for new messages
              </Text>
            </View>
            <Switch
              value={settings.pushEnabled && permissionStatus.granted}
              onValueChange={(value) => updateSetting('pushEnabled', value)}
              disabled={isSaving || !permissionStatus.granted}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
              thumbColor={settings.pushEnabled ? '#3b82f6' : '#9ca3af'}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notification Types</Text>
          
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Message Notifications</Text>
              <Text style={styles.settingDescription}>
                Get notified when you receive new messages
              </Text>
            </View>
            <Switch
              value={settings.messageNotifications}
              onValueChange={(value) => updateSetting('messageNotifications', value)}
              disabled={isSaving}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
              thumbColor={settings.messageNotifications ? '#3b82f6' : '#9ca3af'}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Email Notifications</Text>
              <Text style={styles.settingDescription}>
                Also send notifications via email
              </Text>
            </View>
            <Switch
              value={settings.emailNotifications}
              onValueChange={(value) => updateSetting('emailNotifications', value)}
              disabled={isSaving}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
              thumbColor={settings.emailNotifications ? '#3b82f6' : '#9ca3af'}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Sound</Text>
              <Text style={styles.settingDescription}>
                Play sound with notifications
              </Text>
            </View>
            <Switch
              value={settings.soundEnabled}
              onValueChange={(value) => updateSetting('soundEnabled', value)}
              disabled={isSaving}
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
              thumbColor={settings.soundEnabled ? '#3b82f6' : '#9ca3af'}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Notifications</Text>
          
          <TouchableOpacity 
            style={[
              styles.testButton,
              (!permissionStatus.granted || !settings.pushEnabled) && styles.disabledButton
            ]}
            onPress={testNotification}
            disabled={!permissionStatus.granted || !settings.pushEnabled}
          >
            <Text style={[
              styles.testButtonText,
              (!permissionStatus.granted || !settings.pushEnabled) && styles.disabledButtonText
            ]}>
              Send Test Notification
            </Text>
          </TouchableOpacity>
          
          <Text style={styles.testDescription}>
            Send a test notification to verify your settings are working
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notification Info</Text>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Token Status:</Text>
            <Text style={styles.infoValue}>
              {notificationService.getToken() ? 'Registered' : 'Not Registered'}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Service Status:</Text>
            <Text style={styles.infoValue}>
              {notificationService.isRegisteredForNotifications() ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {isSaving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.savingText}>Updating settings...</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
  },
  permissionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  permissionLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 8,
  },
  permissionValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  permissionGranted: {
    color: '#10b981',
  },
  permissionDenied: {
    color: '#ef4444',
  },
  enableButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  enableButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  testButton: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  disabledButton: {
    backgroundColor: '#d1d5db',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButtonText: {
    color: '#9ca3af',
  },
  testDescription: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  savingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  savingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});