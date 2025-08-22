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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectXAPI } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from '../contexts/AuthContext';

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
        setServerURL('localhost:3000');
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
            setServerURL('localhost:3000');
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
        {isAuthenticated && !isSaving && (
          <TouchableOpacity 
            style={styles.continueButton}
            onPress={() => navigation.navigate('Login' as never)}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
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
              placeholder="localhost:3000 or your-server.com"
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
              trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
              thumbColor={isSecure ? '#3b82f6' : '#9ca3af'}
            />
          </View>

          <View style={styles.urlPreview}>
            <Text style={styles.urlPreviewLabel}>Full URL:</Text>
            <Text style={styles.urlPreviewText}>
              {isSecure ? 'https' : 'http'}://{serverURL || 'localhost:3000'}
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
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    flex: 1,
    textAlign: 'center',
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
  continueButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#10b981',
    borderRadius: 6,
  },
  continueButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  helpText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  switchLabelContainer: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 12,
    color: '#6b7280',
  },
  urlPreview: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  urlPreviewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  urlPreviewText: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#374151',
  },
  buttonGroup: {
    gap: 12,
    marginBottom: 24,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6b7280',
  },
});