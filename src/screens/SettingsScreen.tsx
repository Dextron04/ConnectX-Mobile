import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  Switch,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectXAPI } from '../services/api';
import socketService from '../services/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../styles/theme';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { isAuthenticated } = useAuth();
  const [serverURL, setServerURL] = useState('');
  const [isSecure, setIsSecure] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedURL = await AsyncStorage.getItem('server_url');
      const savedSecure = await AsyncStorage.getItem('use_https');
      
      if (savedURL) {
        setServerURL(savedURL);
        const url = new URL(savedURL);
        setIsSecure(url.protocol === 'https:');
      } else {
        // Default to localhost for development
        setServerURL('localhost:3456');
        setIsSecure(false);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    if (!serverURL.trim()) {
      Alert.alert('Error', 'Please enter a valid server URL');
      return;
    }

    setIsSaving(true);

    try {
      // Construct the full URL
      const protocol = isSecure ? 'https' : 'http';
      const cleanURL = serverURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const fullURL = `${protocol}://${cleanURL}`;

      // Test the connection
      await testConnection(fullURL);

      // Save settings
      await AsyncStorage.setItem('server_url', fullURL);
      await AsyncStorage.setItem('use_https', isSecure.toString());

      // Update API configuration
      connectXAPI.setBaseURL(fullURL);
      socketService.disconnect();
      socketService.connect(fullURL);

      Alert.alert('Success', 'Settings saved successfully!');
    } catch (error: any) {
      Alert.alert(
        'Connection Error',
        `Failed to connect to ${serverURL}. Please check the URL and try again.\n\nError: ${error.message}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async (url: string): Promise<void> => {
    // Test basic connectivity
    const response = await fetch(`${url}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok && response.status !== 401) {
      throw new Error(`Server responded with ${response.status}`);
    }
  };

  const resetToDefault = () => {
    Alert.alert(
      'Reset Settings',
      'Reset to default settings?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: () => {
            setServerURL('localhost:3456');
            setIsSecure(false);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {isAuthenticated && (
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Settings</Text>
        {!isAuthenticated && !isSaving && (
          <TouchableOpacity 
            style={styles.continueButton}
            onPress={() => navigation.navigate('Login' as never)}
          >
            <Text style={styles.continueButtonText}>Continue to Login</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Server Configuration</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverURL}
              onChangeText={setServerURL}
              placeholder="localhost:3456 or your-server.com"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.helpText}>
              Enter the URL of your ConnectX server (without http:// or https://)
            </Text>
          </View>

          <View style={styles.switchGroup}>
            <View style={styles.switchLabelContainer}>
              <Text style={styles.switchLabel}>Use HTTPS</Text>
              <Text style={styles.switchDescription}>
                Enable if your server uses SSL/TLS
              </Text>
            </View>
            <Switch
              value={isSecure}
              onValueChange={setIsSecure}
              trackColor={{ false: '#4B5563', true: '#60A5FA' }}
              thumbColor={isSecure ? '#3B82F6' : '#9CA3AF'}
            />
          </View>

          <View style={styles.urlPreview}>
            <Text style={styles.urlPreviewLabel}>Full URL:</Text>
            <Text style={styles.urlPreviewText}>
              {isSecure ? 'https' : 'http'}://{serverURL || 'localhost:3456'}
            </Text>
          </View>
        </View>

        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={saveSettings}
            disabled={isSaving}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? 'Testing Connection...' : 'Save & Test Connection'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={resetToDefault}
            disabled={isSaving}
          >
            <Text style={styles.secondaryButtonText}>Reset to Default</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>Connection Status</Text>
          <Text style={styles.infoText}>
            {socketService.isConnected() ? 'Connected ✓' : 'Disconnected ✗'}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    backgroundColor: theme.colors.sidebar,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.sidebarBorder,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.sidebarForeground,
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  backButtonText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  continueButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.success,
    borderRadius: theme.borderRadius.sm,
    ...theme.shadows.sm,
  },
  continueButtonText: {
    color: theme.colors.foreground,
    fontWeight: theme.typography.fontWeights.semibold,
    fontSize: theme.typography.fontSizes.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing['2xl'],
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing['2xl'],
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    ...theme.shadows.md,
  },
  sectionTitle: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.lg,
  },
  inputGroup: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
  },
  input: {
    backgroundColor: theme.colors.input,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    fontSize: theme.typography.fontSizes.base,
    marginBottom: theme.spacing.sm,
    color: theme.colors.foreground,
    ...theme.shadows.sm,
  },
  helpText: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    lineHeight: theme.typography.lineHeights.normal * theme.typography.fontSizes.xs,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
  },
  switchLabelContainer: {
    flex: 1,
    marginRight: theme.spacing.lg,
  },
  switchLabel: {
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.xs,
  },
  switchDescription: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
  },
  urlPreview: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  urlPreviewLabel: {
    fontSize: theme.typography.fontSizes.xs,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  urlPreviewText: {
    fontSize: theme.typography.fontSizes.sm,
    fontFamily: 'monospace',
    color: theme.colors.foreground,
  },
  buttonGroup: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing['2xl'],
  },
  button: {
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
  },
  primaryButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  secondaryButton: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  secondaryButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  infoSection: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    ...theme.shadows.sm,
  },
  infoTitle: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
  },
  infoText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
  },
});