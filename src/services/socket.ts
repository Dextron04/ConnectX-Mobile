import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message } from './api';

export interface SocketEvents {
  'new-message': (message: Message) => void;
  'user-typing': (data: { userId: string; conversationId: string; isTyping: boolean }) => void;
  'user-joined': (data: { userId: string; conversationId: string }) => void;
  'user-left': (data: { userId: string; conversationId: string }) => void;
  'message-read': (data: { messageId: string; userId: string }) => void;
}

class SocketService {
  private socket: Socket | null = null;
  private baseURL: string = 'http://localhost:3000';

  connect(baseURL?: string) {
    if (this.socket?.connected) {
      return;
    }

    if (baseURL) {
      this.baseURL = baseURL;
    }

    this.socket = io(this.baseURL, {
      transports: ['websocket'],
      upgrade: true,
      forceNew: true,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Connected to ConnectX server');
      this.authenticateSocket();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from ConnectX server');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  private async authenticateSocket() {
    if (!this.socket) return;

    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      this.socket.emit('authenticate', { token });
    }
  }

  on<K extends keyof SocketEvents>(event: K, callback: SocketEvents[K]) {
    this.socket?.on(event, callback);
  }

  off<K extends keyof SocketEvents>(event: K, callback?: SocketEvents[K]) {
    if (callback) {
      this.socket?.off(event, callback);
    } else {
      this.socket?.off(event);
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