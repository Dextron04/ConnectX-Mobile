import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message } from './api';
import { SERVER_CONFIG, SOCKET_CONFIG } from '../config/server';

export interface SocketEvents {
  'new-message': (message: Message) => void;
  'user-typing': (data: { userId: string; conversationId: string; isTyping: boolean }) => void;
  'user-joined': (data: { userId: string; conversationId: string }) => void;
  'user-left': (data: { userId: string; conversationId: string }) => void;
  'message-read': (data: { messageId: string; userId: string }) => void;
}

class SocketService {
  private socket: Socket | null = null;
  private baseURL: string = SERVER_CONFIG.SOCKET_URL;

  async connect(baseURL?: string) {
    if (this.socket?.connected) {
      return;
    }

    if (baseURL) {
      this.baseURL = baseURL;
    }

    // Get token before connecting
    const token = await AsyncStorage.getItem('auth_token');

    this.socket = io(this.baseURL, {
      ...SOCKET_CONFIG,
      auth: {
        token: token
      }
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Connected to ConnectX server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from ConnectX server');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }


  on<K extends keyof SocketEvents>(event: K, callback: SocketEvents[K]) {
    this.socket?.on(event as string, callback as (...args: any[]) => void);
  }

  off<K extends keyof SocketEvents>(event: K, callback?: SocketEvents[K]) {
    if (callback) {
      this.socket?.off(event as string, callback as (...args: any[]) => void);
    } else {
      this.socket?.off(event as string);
    }
  }

  emit(event: string, data?: any) {
    this.socket?.emit(event, data);
  }

  joinConversation(conversationId: string) {
    this.emit('join-conversation', { conversationId });
  }

  leaveConversation(conversationId: string) {
    this.emit('leave-conversation', { conversationId });
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    this.emit('typing', { conversationId, isTyping });
  }

  markMessageAsRead(messageId: string) {
    this.emit('mark-read', { messageId });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const socketService = new SocketService();