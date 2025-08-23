import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message } from './api';
import { SERVER_CONFIG, SOCKET_CONFIG } from '../config/server';

export interface SocketEvents {
  'new-message': (message: Message) => void;
  'user-typing': (data: { userId: string; conversationId: string; isTyping: boolean }) => void;
  'user-stopped-typing': (data: { userId: string; conversationId: string }) => void;
  'user-joined': (data: { userId: string; conversationId: string }) => void;
  'user-left': (data: { userId: string; conversationId: string }) => void;
  'user-status-changed': (data: { userId: string; isOnline: boolean }) => void;
  'message-read': (data: { messageId: string; userId: string; readAt?: string }) => void;
}

class SocketService {
  private socket: Socket | null = null;
  private baseURL: string = SERVER_CONFIG.SOCKET_URL;

  async connect(baseURL?: string) {
    if (this.socket?.connected) {
      console.log('🔌 Socket already connected, skipping');
      return;
    }

    if (baseURL) {
      this.baseURL = baseURL;
    }

    // Get token before connecting
    const token = await AsyncStorage.getItem('auth_token');

    console.log('🔌 Connecting to socket server:', this.baseURL);
    console.log('🔌 Socket config:', SOCKET_CONFIG);
    console.log('🔌 Auth token present:', !!token);
    console.log('🔌 Auth token preview:', token ? token.substring(0, 20) + '...' : 'null');

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
      console.log('🔗 Socket connected successfully:', this.socket?.id);
      console.log('🔗 Socket transport:', this.socket?.io.engine.transport.name);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        error: error
      });
    });

    this.socket.on('error', (error) => {
      console.error('🔌 Socket error:', error);
    });

    // Additional debugging events
    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('🔄 Socket reconnection attempt:', attemptNumber);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('🔄 Socket reconnection error:', error.message);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('🔄 Socket reconnection failed - giving up');
    });
  }

  joinConversation(conversationId: string) {
    if (this.socket?.connected) {
      console.log('🏠 Joining conversation:', conversationId);
      this.socket.emit('join-conversation', conversationId);
    }
  }

  leaveConversation(conversationId: string) {
    if (this.socket?.connected) {
      console.log('🚪 Leaving conversation:', conversationId);
      this.socket.emit('leave-conversation', conversationId);
    }
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    if (this.socket?.connected) {
      const event = isTyping ? 'typing-start' : 'typing-stop';
      console.log(`⌨️ Emitting ${event} for conversation:`, conversationId);
      this.socket.emit(event, { conversationId });
    }
  }

  markMessageAsRead(messageId: string) {
    if (this.socket?.connected) {
      this.socket.emit('mark-message-read', { messageId });
    }
  }

  sendMessage(data: { conversationId: string; receiverId: string; content?: string; type?: 'TEXT' | 'IMAGE' | 'FILE'; imageUrl?: string; fileName?: string; fileSize?: number }) {
    if (this.socket?.connected) {
      console.log('📤 Emitting socket message:', {
        conversationId: data.conversationId,
        type: data.type,
        hasContent: !!data.content
      });
      this.socket.emit('send-message', {
        conversationId: data.conversationId,
        receiverId: data.receiverId,
        content: data.content,
        type: data.type || 'TEXT',
        imageUrl: data.imageUrl,
        fileName: data.fileName,
        fileSize: data.fileSize
      });
    }
  }

  on<K extends keyof SocketEvents>(event: K, callback: SocketEvents[K]) {
    if (this.socket) {
      this.socket.on(event as string, callback as any);
    }
  }

  off<K extends keyof SocketEvents>(event: K, callback?: SocketEvents[K]) {
    if (this.socket) {
      this.socket.off(event as string, callback as any);
    }
  }

  emit(event: string, data?: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
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

  getConnectionStatus(): { connected: boolean; url: string; socketId?: string } {
    return {
      connected: this.socket?.connected ?? false,
      url: this.baseURL,
      socketId: this.socket?.id
    };
  }
}

const socketService = new SocketService();
export default socketService;
