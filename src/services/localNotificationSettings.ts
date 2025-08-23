import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LocalNotificationSettings {
    pushEnabled: boolean;
    messageNotifications: boolean;
    emailNotifications: boolean;
    soundEnabled: boolean;
}

class LocalNotificationSettingsService {
    private storageKey = 'notification_settings';

    async getSettings(): Promise<LocalNotificationSettings> {
        try {
            const settingsString = await AsyncStorage.getItem(this.storageKey);
            if (settingsString) {
                return JSON.parse(settingsString);
            }
        } catch (error) {
            console.error('Failed to load local notification settings:', error);
        }

        // Return default settings
        return {
            pushEnabled: true,
            messageNotifications: true,
            emailNotifications: true,
            soundEnabled: true,
        };
    }

    async updateSettings(settings: Partial<LocalNotificationSettings>): Promise<void> {
        try {
            const currentSettings = await this.getSettings();
            const newSettings = { ...currentSettings, ...settings };
            await AsyncStorage.setItem(this.storageKey, JSON.stringify(newSettings));
            console.log('📱 Saved notification settings locally:', newSettings);
        } catch (error) {
            console.error('Failed to save local notification settings:', error);
        }
    }

    async clearSettings(): Promise<void> {
        try {
            await AsyncStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Failed to clear local notification settings:', error);
        }
    }
}

export const localNotificationSettings = new LocalNotificationSettingsService();
