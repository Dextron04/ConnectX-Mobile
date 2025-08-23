import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { connectXAPI, Conversation, Message } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from '../contexts/AuthContext';

export const ChatScreen: React.FC = () => {
  const navigation = useNavigation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  
  const messagesEndRef = useRef<FlatList>(null);
  const { user, logout } = useAuth();

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
    setupSocketListeners();

    return () => {
      socketService.off('new-message');
      socketService.off('message-read');
      socketService.off('user-typing');
      socketService.off('user-stopped-typing');
      socketService.off('user-status-changed');
    };
  }, []);

  // Load messages when chat is selected
  useEffect(() => {
    if (selectedChat) {
      loadMessages(selectedChat);
      
      // Join conversation room
      socketService.emit('join-conversation', selectedChat);
      
      return () => {
        // Leave conversation room
        socketService.emit('leave-conversation', selectedChat);
      };
    }
  }, [selectedChat]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const loadConversations = async () => {
    try {
      console.log('🔄 Loading conversations...');
      setIsLoading(true);
      const convs = await connectXAPI.getConversations();
      console.log('✅ Loaded conversations:', convs.length, 'conversations');
      console.log('📋 Conversations data:', JSON.stringify(convs, null, 2));
      setConversations(convs);
      
      // Auto-select first conversation if available
      if (convs.length > 0 && !selectedChat) {
        console.log('🎯 Auto-selecting first conversation:', convs[0].id);
        setSelectedChat(convs[0].id);
      }
    } catch (error: any) {
      console.error('❌ Failed to load conversations:', error);
      console.error('❌ Error details:', error.message);
      Alert.alert('Error', `Failed to load conversations: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      setIsLoadingMessages(true);
      const msgs = await connectXAPI.getMessages(conversationId);
      setMessages(msgs);
    } catch (error: any) {
      console.error('Failed to load messages:', error);
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const setupSocketListeners = () => {
    // Listen for new messages
    socketService.on('new-message', (message: Message) => {
      console.log('Received new message:', message);
      
      // Add message to current conversation
      if (message.senderId !== user?.id || message.receiverId !== user?.id) {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.find(m => m.id === message.id)) {
            return prev;
          }
          return [...prev, message];
        });
        
        // Mark message as read if user is viewing this conversation and is the receiver
        if (message.receiverId === user?.id && selectedChat === message.conversationId) {
          setTimeout(() => {
            connectXAPI.markMessageAsRead(message.id).catch(console.error);
          }, 1000);
        }
      }
      
      // Update conversation list
      loadConversations();
    });
    
    // Listen for read receipts
    socketService.on('message-read', ({ messageId, readAt }: { messageId: string, readAt: string }) => {
      setMessages(prev => 
        prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, isRead: true, readAt }
            : msg
        )
      );
    });

    // Listen for typing indicators
    socketService.on('user-typing', ({ userId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === selectedChat && userId !== user?.id) {
        setIsTyping(true);
        setTimeout(() => setIsTyping(false), 3000);
      }
    });

    socketService.on('user-stopped-typing', ({ userId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === selectedChat && userId !== user?.id) {
        setIsTyping(false);
      }
    });

    // Listen for user status changes
    socketService.on('user-status-changed', ({ userId, isOnline }: { userId: string; isOnline: boolean }) => {
      setConversations(prev => 
        prev.map(conv => 
          conv.participant.id === userId 
            ? { ...conv, participant: { ...conv.participant, isOnline } }
            : conv
        )
      );
    });
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedChat || isSending) {
      return;
    }

    const selectedConv = conversations.find(c => c.id === selectedChat);
    if (!selectedConv) return;

    setIsSending(true);
    const messageContent = newMessage.trim();
    setNewMessage('');

    try {
      const message = await connectXAPI.sendMessage(selectedConv.participant.id, messageContent);
      
      // Add message to current conversation
      setMessages(prev => [...prev, message]);
      
      // Update conversation list
      loadConversations();
    } catch (error: any) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
      setNewMessage(messageContent); // Restore message on error
    } finally {
      setIsSending(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const renderConversationItem = useCallback(({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={[
        styles.conversationItem,
        selectedChat === item.id && styles.selectedConversation
      ]}
      onPress={() => setSelectedChat(item.id)}
    >
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.participant.username?.[0]?.toUpperCase() || '?'}
          </Text>
        </View>
        {item.participant.isOnline && <View style={styles.onlineIndicator} />}
      </View>
      
      <View style={styles.conversationInfo}>
        <View style={styles.conversationHeader}>
          <Text style={styles.username} numberOfLines={1}>
            {item.participant.username}
          </Text>
          {item.lastMessage && (
            <Text style={styles.messageTime}>
              {formatLastMessageTime(item.lastMessage.createdAt)}
            </Text>
          )}
        </View>
        
        {item.lastMessage && (
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.lastMessage.type === 'IMAGE' ? '📷 Image' : 
             item.lastMessage.type === 'FILE' ? '📎 File' : 
             item.lastMessage.content || 'Message'}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  ), [selectedChat]);

  const renderMessageItem = useCallback(({ item }: { item: Message }) => {
    const isMyMessage = item.senderId === user?.id;
    
    return (
      <View style={[
        styles.messageContainer,
        isMyMessage ? styles.myMessage : styles.otherMessage
      ]}>
        {!isMyMessage && (
          <Text style={styles.senderName}>{item.sender.username}</Text>
        )}
        
        {item.type === 'TEXT' && (
          <Text style={[
            styles.messageContent,
            isMyMessage ? styles.myMessageText : styles.otherMessageText
          ]}>
            {item.content}
          </Text>
        )}
        
        {item.type === 'IMAGE' && (
          <Text style={[
            styles.messageContent,
            isMyMessage ? styles.myMessageText : styles.otherMessageText
          ]}>
            📷 Image
          </Text>
        )}
        
        {item.type === 'FILE' && (
          <Text style={[
            styles.messageContent,
            isMyMessage ? styles.myMessageText : styles.otherMessageText
          ]}>
            📎 {item.fileName || 'File'}
          </Text>
        )}
        
        <View style={styles.messageFooter}>
          <Text style={[
            styles.messageTime,
            isMyMessage ? styles.myMessageTime : styles.otherMessageTime
          ]}>
            {formatTime(item.createdAt)}
          </Text>
          {isMyMessage && (
            <Text style={[
              styles.readStatus,
              item.isRead ? styles.readStatusRead : styles.readStatusUnread
            ]}>
              {item.isRead ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </View>
    );
  }, [user?.id]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show conversation list on mobile if no chat selected
  if (!selectedChat) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ConnectX</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity 
              style={styles.libraryButton} 
              onPress={() => navigation.navigate('DigitalLibrary' as never)}
            >
              <Text style={styles.libraryText}>🖼️</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.notificationButton} 
              onPress={() => navigation.navigate('NotificationSettings' as never)}
            >
              <Text style={styles.notificationText}>🔔</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.settingsButton} 
              onPress={() => navigation.navigate('Settings' as never)}
            >
              <Text style={styles.settingsText}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.conversationsList}>
          <Text style={styles.panelTitle}>Conversations</Text>
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderConversationItem}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No conversations yet</Text>
              </View>
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  // Show chat view when conversation is selected
  const selectedConv = conversations.find(c => c.id === selectedChat);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.chatHeader}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => setSelectedChat(null)}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        
        <View style={styles.chatHeaderInfo}>
          <Text style={styles.chatHeaderTitle} numberOfLines={1}>
            {selectedConv?.participant.username}
          </Text>
          {selectedConv?.participant.isOnline ? (
            <Text style={styles.onlineStatus}>Online</Text>
          ) : (
            <Text style={styles.offlineStatus}>Offline</Text>
          )}
        </View>

        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={() => navigation.navigate('Settings' as never)}
        >
          <Text style={styles.settingsText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {isLoadingMessages ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3b82f6" />
          </View>
        ) : (
          <>
            <FlatList
              ref={messagesEndRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessageItem}
              style={styles.messagesList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.messagesContainer}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>No messages yet</Text>
                  <Text style={styles.emptyStateSubtext}>Send a message to start the conversation</Text>
                </View>
              }
            />
            
            {isTyping && (
              <View style={styles.typingIndicator}>
                <Text style={styles.typingText}>{selectedConv?.participant.username} is typing...</Text>
              </View>
            )}
            
            <View style={styles.messageInput}>
              <TextInput
                style={styles.textInput}
                value={newMessage}
                onChangeText={setNewMessage}
                placeholder="Type a message..."
                multiline
                maxLength={1000}
                onSubmitEditing={sendMessage}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!newMessage.trim() || isSending) && styles.disabledSendButton
                ]}
                onPress={sendMessage}
                disabled={!newMessage.trim() || isSending}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.sendButtonText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  libraryButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#10b981',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryText: {
    fontSize: 16,
  },
  notificationButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#8b5cf6',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationText: {
    fontSize: 16,
  },
  settingsButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#6b7280',
    borderRadius: 6,
  },
  settingsText: {
    color: '#fff',
    fontWeight: '600',
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ef4444',
    borderRadius: 6,
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
  conversationsList: {
    flex: 1,
    backgroundColor: '#fff',
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  selectedConversation: {
    backgroundColor: '#eff6ff',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#fff',
  },
  conversationInfo: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  messageTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  readStatus: {
    fontSize: 12,
    marginLeft: 8,
  },
  readStatusRead: {
    color: '#10b981',
  },
  readStatusUnread: {
    color: '#9ca3af',
  },
  lastMessage: {
    fontSize: 14,
    color: '#6b7280',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    paddingRight: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '600',
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  onlineStatus: {
    fontSize: 12,
    color: '#10b981',
  },
  offlineStatus: {
    fontSize: 12,
    color: '#6b7280',
  },
  chatContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  messagesContainer: {
    paddingVertical: 16,
  },
  messageContainer: {
    marginVertical: 4,
    maxWidth: '80%',
    padding: 12,
    borderRadius: 12,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#3b82f6',
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  messageContent: {
    fontSize: 16,
    marginBottom: 4,
  },
  myMessageText: {
    color: '#fff',
  },
  otherMessageText: {
    color: '#1f2937',
  },
  myMessageTime: {
    color: '#dbeafe',
  },
  otherMessageTime: {
    color: '#9ca3af',
  },
  typingIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  messageInput: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabledSendButton: {
    backgroundColor: '#9ca3af',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});