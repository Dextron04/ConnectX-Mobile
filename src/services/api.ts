import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SERVER_CONFIG, API_TIMEOUT } from '../config/server';

export interface User {
  id: string;
  username: string;
  avatar?: string;
  isOnline?: boolean;
  lastSeen?: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface Message {
  id: string;
  content?: string;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  senderId: string;
  receiverId: string;
  imageUrl?: string;
  fileName?: string;
  isRead?: boolean;
  readAt?: string;
  createdAt: string;
  sender: User;
}

export interface Conversation {
  id: string;
  participant: User;
  lastMessage?: {
    content?: string;
    type: string;
    sender: User;
    createdAt: string;
  };
  updatedAt: string;
}

class ConnectXAPI {
  private api: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string = SERVER_CONFIG.BASE_URL) {
    this.baseURL = baseURL;
    this.api = axios.create({
      baseURL: `${baseURL}/api`,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.api.interceptors.request.use(async (config) => {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user');
        }
        return Promise.reject(error);
      }
    );
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });

    const { user, token } = response.data;

    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));

    return response.data;
  }

  async register(email: string, password: string, name: string): Promise<LoginResponse> {
    const response = await this.api.post<LoginResponse>('/auth/register', {
      email,
      password,
      name,
    });

    const { user, token } = response.data;

    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));

    return response.data;
  }

  async getMe(): Promise<User> {
    const response = await this.api.get<User>('/auth/me');
    return response.data;
  }

  async getConversations(): Promise<Conversation[]> {
    try {
      console.log('🔍 Fetching conversations...');
      const response = await this.api.get('/conversations');
      console.log('📦 Conversations response:', response.data);
      console.log('📊 Number of conversations:', response.data.conversations?.length || 0);
      return response.data.conversations || [];
    } catch (error: any) {
      console.error('❌ Conversations API error:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      throw error;
    }
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const response = await this.api.get(`/conversations/${conversationId}/messages`);
    return response.data.messages;
  }

  async sendMessage(receiverId: string, content: string, type: 'TEXT' | 'IMAGE' | 'FILE' = 'TEXT'): Promise<Message> {
    const response = await this.api.post('/messages', {
      receiverId,
      content,
      type,
    });
    return response.data;
  }

  async logout(): Promise<void> {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
  }

  async getStoredUser(): Promise<User | null> {
    try {
      const userString = await AsyncStorage.getItem('user');
      return userString ? JSON.parse(userString) : null;
    } catch {
      return null;
    }
  }

  async getStoredToken(): Promise<string | null> {
    return await AsyncStorage.getItem('auth_token');
  }

  async subscribeToNotifications(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<{ success: boolean; subscriptionId: string }> {
    const response = await this.api.post('/notifications/subscribe', subscription);
    return response.data;
  }

  async unsubscribeFromNotifications(endpoint: string): Promise<{ success: boolean }> {
    const response = await this.api.delete('/notifications/subscribe', {
      data: { endpoint }
    });
    return response.data;
  }

  async getNotificationSettings(): Promise<{
    pushEnabled: boolean;
    messageNotifications: boolean;
    emailNotifications: boolean;
    soundEnabled: boolean;
  }> {
    try {
      const response = await this.api.get('/notifications/settings');
      return response.data;
    } catch (error: any) {
      // If server doesn't support this endpoint, return default settings
      if (error.response?.status === 404 || error.response?.status === 405) {
        console.warn('Server doesn\'t support notification settings, using defaults');
        return {
          pushEnabled: true,
          messageNotifications: true,
          emailNotifications: true,
          soundEnabled: true,
        };
      }
      throw error;
    }
  }

  async updateNotificationSettings(settings: {
    pushEnabled?: boolean;
    messageNotifications?: boolean;
    emailNotifications?: boolean;
    soundEnabled?: boolean;
  }): Promise<{ success: boolean }> {
    try {
      const response = await this.api.post('/notifications/settings', settings);
      return response.data;
    } catch (error: any) {
      // If server doesn't support this endpoint, just return success for local handling
      if (error.response?.status === 404 || error.response?.status === 405) {
        console.warn('Server doesn\'t support notification settings update, handling locally');
        return { success: true };
      }
      throw error;
    }
  }

  setBaseURL(url: string) {
    this.baseURL = url;
    this.api.defaults.baseURL = `${url}/api`;
  }
}

export const connectXAPI = new ConnectXAPI();