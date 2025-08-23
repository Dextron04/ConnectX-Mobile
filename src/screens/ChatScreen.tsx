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
import socketService from '../services/socket';
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
  const [isNearBottom, setIsNearBottom] = useState(true); // Track if user is near bottom
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  const messagesEndRef = useRef<FlatList>(null);
  const { user, logout } = useAuth();
  const isNearBottomRef = useRef(true);
  const selectedChatRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(()=>{ isNearBottomRef.current = isNearBottom; }, [isNearBottom]);
  useEffect(()=>{ selectedChatRef.current = selectedChat; }, [selectedChat]);
  useEffect(()=>{ messagesRef.current = messages; }, [messages]);

  // Load conversations on mount
  useEffect(() => {
    console.log('🚀 ChatScreen mounted, loading conversations...');
    loadConversations();
    setupSocketListeners();
    
    // Check socket connection status
    setTimeout(() => {
      const status = socketService.getConnectionStatus();
      console.log('🔌 Socket status on mount:', status);
      if (!status.connected) {
        console.warn('⚠️ Socket not connected! Real-time messages may not work.');
      }
    }, 1000);

    return () => {
      console.log('🧹 Cleaning up socket listeners...');
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
      console.log('💬 Loading messages for conversation:', selectedChat);
      const selectedConv = conversations.find(c => c.id === selectedChat);
      console.log('🔍 Found conversation:', selectedConv ? {
        id: selectedConv.id,
        participantId: selectedConv.participant.id,
        participantName: selectedConv.participant.username
      } : 'Not found');
      
      loadMessages(selectedChat);
      
      // Join conversation room
      console.log('🏠 Joining conversation room:', selectedChat);
      socketService.emit('join-conversation', selectedChat);
      
      return () => {
        console.log('🚪 Leaving conversation room:', selectedChat);
        // Leave conversation room
        socketService.emit('leave-conversation', selectedChat);
      };
    }
  }, [selectedChat, conversations]); // Added conversations dependency

  // Smart auto-scroll - only scroll if user is near bottom
  useEffect(() => {
    if (messages.length > 0 && isNearBottom) {
      console.log('📜 Smart auto-scroll triggered, message count:', messages.length);
      // Use shorter timeout for smoother experience
      setTimeout(() => {
        messagesEndRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [messages.length, isNearBottom]); // Only scroll when near bottom

  const loadConversations = async () => {
    try {
      console.log('🔄 Loading conversations from server...');
      const fetchedConversations = await connectXAPI.getConversations();
      setConversations(fetchedConversations);
      console.log('✅ Conversations loaded:', fetchedConversations.length);
      
      // Debug: Log conversation structure
      if (fetchedConversations.length > 0) {
        console.log('📋 First conversation structure:', {
          id: fetchedConversations[0].id,
          participant: {
            id: fetchedConversations[0].participant.id,
            username: fetchedConversations[0].participant.username
          },
          lastMessage: fetchedConversations[0].lastMessage
        });
      }
    } catch (error: any) {
      console.error('❌ Conversations API error:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      Alert.alert('Error', 'Failed to load conversations');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      console.log('📨 Loading messages for conversation ID:', conversationId);
      setIsLoadingMessages(true);
      const msgs = await connectXAPI.getMessages(conversationId);
      setMessages(msgs);
      console.log('✅ Messages loaded:', msgs.length);
      
      if (msgs.length > 0) {
        console.log('📝 Last message:', {
          id: msgs[msgs.length - 1].id,
          content: msgs[msgs.length - 1].content,
          senderId: msgs[msgs.length - 1].senderId,
          receiverId: msgs[msgs.length - 1].receiverId
        });
      }
    } catch (error: any) {
      console.error('❌ Failed to load messages:', error);
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setIsLoadingMessages(false);
    }
  };

  // Update conversation list locally when receiving new messages
  const updateConversationLocally = (message: Message) => {
    setConversations(prev => {
      return prev.map(conv => {
        // Check if this message affects this conversation
        const isForThisConv = 
          (message.senderId === user?.id && message.receiverId === conv.participant.id) ||
          (message.receiverId === user?.id && message.senderId === conv.participant.id);
          
        if (isForThisConv) {
          return {
            ...conv,
            lastMessage: {
              content: message.content,
              type: message.type,
              sender: message.sender,
              createdAt: message.createdAt
            },
            updatedAt: message.createdAt
          };
        }
        return conv;
      });
    });
  };

  const setupSocketListeners = () => {
    console.log('🔧 Setting up socket listeners (refresh)...');
    // Clear previous to avoid duplicates
    socketService.off('new-message');
    socketService.off('message-read');
    socketService.off('user-typing');
    socketService.off('user-stopped-typing');
    socketService.off('user-status-changed');

    socketService.on('new-message', (message: Message) => {
      const activeChat = selectedChatRef.current;
      const currentUserId = user?.id;
      const isForActive = activeChat && (
        (message.senderId === currentUserId && message.receiverId && conversations.find(c=>c.id===activeChat)?.participant.id === message.receiverId) ||
        (message.receiverId === currentUserId && conversations.find(c=>c.id===activeChat)?.participant.id === message.senderId)
      );

      if (isForActive) {
        setMessages(prev => {
          if (prev.find(m=>m.id===message.id)) return prev;
          const updated = [...prev, message];
          return updated;
        });
        // Auto-scroll if user is near bottom or message is mine
        if (isNearBottomRef.current || message.senderId === currentUserId) {
          requestAnimationFrame(()=>messagesEndRef.current?.scrollToEnd({ animated: true }));
        }
        if (message.receiverId === currentUserId) {
          setTimeout(()=>connectXAPI.markMessageAsRead(message.id).catch(()=>{}), 800);
        }
      } else {
        // Increment unread for that conversation
        const targetConv = conversations.find(conv =>
          (message.senderId === conv.participant.id && message.receiverId === currentUserId) ||
          (message.receiverId === conv.participant.id && message.senderId === currentUserId)
        );
        if (targetConv) {
          setUnreadCounts(u => ({ ...u, [targetConv.id]: (u[targetConv.id]||0) + 1 }));
        }
      }
      updateConversationLocally(message);
    });

    socketService.on('message-read', ({ messageId, userId, readAt }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isRead: true, readAt: readAt || new Date().toISOString() } : m));
    });

    socketService.on('user-typing', ({ userId, conversationId }) => {
      if (conversationId === selectedChatRef.current && userId !== user?.id) {
        setIsTyping(true);
        typingTimeoutRef.current && clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(()=> setIsTyping(false), 2500);
      }
    });

    socketService.on('user-stopped-typing', ({ userId, conversationId }) => {
      if (conversationId === selectedChatRef.current && userId !== user?.id) {
        setIsTyping(false);
      }
    });

    socketService.on('user-status-changed', ({ userId, isOnline }) => {
      setConversations(prev => prev.map(c => c.participant.id === userId ? { ...c, participant: { ...c.participant, isOnline } } : c));
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
      // Stop typing indicator
      socketService.sendTyping(selectedConv.id, false);
      // Optimistic emit via socket for real-time delivery
      if (socketService.isConnected()) {
        socketService.sendMessage({
          conversationId: selectedConv.id,
          receiverId: selectedConv.participant.id,
          content: messageContent,
          type: 'TEXT'
        });
      }
      const message = await connectXAPI.sendMessage(selectedConv.id, selectedConv.participant.id, messageContent);
      
      // Add message to current conversation
      setMessages(prev => {
        const newMessages = [...prev, message];
        console.log('📤 Message sent, total messages:', newMessages.length);
        return newMessages;
      });
      
      // Update conversation list locally instead of reloading
      updateConversationLocally(message);
      
      // Immediately scroll to bottom after sending
      setTimeout(() => {
        messagesEndRef.current?.scrollToEnd({ animated: true });
      }, 100);
      
      console.log('📤 Message sent and conversation updated locally');
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

  // Debug function to manually scroll to bottom
  const scrollToBottom = () => {
    console.log('🔄 Manual scroll to bottom triggered');
    messagesEndRef.current?.scrollToEnd({ animated: true });
    setIsNearBottom(true); // User manually scrolled to bottom
  };

  // Check if user is near the bottom of the conversation
  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 120;
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
    if (isAtBottom !== isNearBottomRef.current) {
      isNearBottomRef.current = isAtBottom;
      setIsNearBottom(isAtBottom);
    }
  };

  // Debug function to test socket connection
  const testSocketConnection = () => {
    console.log('🧪 Testing socket connection...');
    const status = socketService.getConnectionStatus();
    console.log('🔌 Socket status:', status);
    
    if (status.connected) {
      Alert.alert('Socket Test', `Connected to: ${status.url}\nSocket ID: ${status.socketId}`);
    } else {
      Alert.alert('Socket Test', 'Socket is not connected! Real-time messages will not work.');
    }
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

  // Show unread badge on conversation list
  const renderConversationItem = useCallback(({ item }: { item: Conversation }) => {
    const unread = unreadCounts[item.id] || 0;
    return (
      <TouchableOpacity
        style={[styles.conversationItem, selectedChat === item.id && styles.selectedConversation]}
        onPress={() => setSelectedChat(item.id)}
      >
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{item.participant.username?.[0]?.toUpperCase() || '?'}</Text></View>
          {item.participant.isOnline && <View style={styles.onlineIndicator} />}
        </View>
        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <Text style={styles.username} numberOfLines={1}>{item.participant.username}</Text>
            {item.lastMessage && (<Text style={styles.messageTime}>{formatLastMessageTime(item.lastMessage.createdAt)}</Text>)}
          </View>
          {item.lastMessage && (<Text style={styles.lastMessage} numberOfLines={1}>{item.lastMessage.type === 'IMAGE' ? '📷 Image' : item.lastMessage.type === 'FILE' ? '📎 File' : item.lastMessage.content || 'Message'}</Text>)}
        </View>
        {unread > 0 && (
          <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text></View>
        )}
      </TouchableOpacity>
    );
  }, [selectedChat, unreadCounts]);

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
        
        <TouchableOpacity 
          style={[styles.settingsButton, { marginLeft: 8 }]} 
          onPress={testSocketConnection}
        >
          <Text style={styles.settingsText}>🔌</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        key={`chat-${selectedChat}-${messages.length}`} // Force re-render when conversation or message count changes
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
              removeClippedSubviews={false} // Prevent clipping issues
              onScroll={handleScroll} // Track scroll position
              scrollEventThrottle={100} // Throttle scroll events
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 10
              }}
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
                onChangeText={(text)=>{
                  setNewMessage(text);
                  if (selectedConv) {
                    socketService.sendTyping(selectedConv.id, text.trim().length>0);
                  }
                }}
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
    color: '#6b7280',
  },
  unreadBadge: {
    backgroundColor: '#ef4444',
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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