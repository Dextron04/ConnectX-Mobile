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
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
// @ts-ignore
import * as ImagePicker from 'expo-image-picker';
import { connectXAPI, Conversation, Message } from '../services/api';
import socketService from '../services/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../styles/theme';

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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);

  const messagesEndRef = useRef<FlatList>(null);
  const { user, logout } = useAuth();
  const isNearBottomRef = useRef(true);
  const selectedChatRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoScrollMsgIdRef = useRef<string | null>(null);
  const autoScrollRequestedRef = useRef(false);
  const autoScrollRetryRef = useRef(0);
  const contentSizeRef = useRef({ width: 0, height: 0 });

  // Function to deduplicate messages
  const deduplicateMessages = useCallback((messages: Message[]) => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    // First pass - identify duplicates
    messages.forEach(message => {
      if (seen.has(message.id)) {
        duplicates.push(message.id);
      }
      seen.add(message.id);
    });

    // Log duplicates if found
    if (duplicates.length > 0) {
      console.log(`🗑️ Found ${duplicates.length} duplicate messages:`, duplicates);
    }

    // Second pass - filter
    seen.clear();
    return messages.filter(message => {
      if (seen.has(message.id)) {
        return false;
      }
      seen.add(message.id);
      return true;
    });
  }, []);

  // This has been replaced with processedMessageIds defined above

  // Enhanced auto-scroll with multiple fallback strategies
  const performAutoScroll = (animated = true) => {
    const flatList = messagesEndRef.current;
    if (!flatList) {
      console.log('⚠️ performAutoScroll: No FlatList ref available');
      return;
    }

    console.log(`🔄 performAutoScroll: Scrolling to newest message (animated: ${animated}, messages: ${messages.length})`);

    // With inverted FlatList, scroll to top (offset 0) to show newest messages
    try {
      // @ts-ignore
      flatList.scrollToOffset({ offset: 0, animated });
      console.log('✅ scrollToOffset(0) executed');
    } catch (e) {
      console.log('❌ scrollToOffset failed:', e);
    }

    // Also try scrollToIndex to first item (newest message in inverted list)
    try {
      if (messages.length > 0) {
        // @ts-ignore
        flatList.scrollToIndex({ index: 0, animated });
        console.log('✅ scrollToIndex(0) executed');
      }
    } catch (e) {
      console.log('❌ scrollToIndex failed:', e);
    }
  };

  const scheduleAutoScroll = () => {
    if (autoScrollRetryRef.current > 2) return;
    autoScrollRetryRef.current += 1;

    // Immediate scroll to show latest message
    performAutoScroll(true);

    // Additional attempts to ensure it sticks
    setTimeout(() => performAutoScroll(false), 50);
    setTimeout(() => performAutoScroll(false), 150);
  };

  // Track processed message IDs to prevent duplicates
  const processedMessageIds = useRef(new Set<string>());

  // Generate stable keys for messages to prevent duplicate key issues in React rendering
  const getStableMessageKey = useCallback((message: Message) => {
    // For real messages, use the ID directly
    if (!message.id.startsWith('temp-')) {
      return `msg-${message.id}`;
    }

    // For temp messages, create a composite key with content and timestamp
    // to ensure uniqueness even if multiple temp messages are created
    const contentHash = message.content?.substring(0, 20) || '';
    return `tmp-${message.senderId}-${contentHash}-${message.createdAt}`;
  }, []);

  useEffect(() => { isNearBottomRef.current = isNearBottom; }, [isNearBottom]);
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
  useEffect(() => {
    messagesRef.current = messages;
    // Clear processed message tracking when messages change significantly
    const currentIds = new Set(messages.map(m => m.id).filter(id => !id.startsWith('temp-')));
    processedMessageIds.current = currentIds;
  }, [messages]);

  // Load conversations on mount
  useEffect(() => {
    console.log('🚀 ChatScreen mounted, loading conversations...');
    loadConversations();
    setupSocketListeners();

    // Check socket connection status with retry
    const checkSocketStatus = () => {
      const status = socketService.getConnectionStatus();
      console.log('🔌 Socket status on mount:', status);
      if (!status.connected) {
        console.warn('⚠️ Socket not connected! Attempting to reconnect...');
        // Try to reconnect if not connected
        setTimeout(() => {
          if (!socketService.isConnected()) {
            console.log('🔄 Attempting socket reconnection...');
            // We can't directly reconnect here, but we can check auth context
          }
        }, 2000);
      }
    };

    setTimeout(checkSocketStatus, 1000);

    return () => {
      console.log('🧹 Cleaning up socket listeners...');
      socketService.off('new-message');
      socketService.off('message-read');
      socketService.off('user-typing');
      socketService.off('user-stopped-typing');
      socketService.off('user-status-changed');

      // Clear typing debounce
      typingDebounceRef.current && clearTimeout(typingDebounceRef.current);
      typingTimeoutRef.current && clearTimeout(typingTimeoutRef.current);
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

      // Unified join via service (avoid duplicate raw emit)
      console.log('🏠 Joining conversation via socket service:', selectedChat);
      socketService.joinConversation(selectedChat);
      // Reset unread for this conversation
      setUnreadCounts(u => ({ ...u, [selectedChat]: 0 }));

      return () => {
        console.log('🚪 Leaving conversation:', selectedChat);
        socketService.leaveConversation(selectedChat);
      };
    }
  }, [selectedChat]); // depend only on selectedChat to avoid duplicate joins

  // Smart auto-scroll - only scroll if user is near bottom
  useEffect(() => {
    if (messages.length > 0 && isNearBottom) {
      console.log('📜 Smart auto-scroll triggered, message count:', messages.length);
      // Use inverted FlatList auto-scroll for smoother experience
      setTimeout(() => {
        performAutoScroll(true);
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

      // Clear processed messages cache when switching conversations
      processedMessageIds.current.clear();

      setIsLoadingMessages(true);
      const msgs = await connectXAPI.getMessages(conversationId);
      setMessages(msgs);
      // Force scroll after initial load for inverted FlatList
      requestAnimationFrame(() => {
        performAutoScroll(false);
        isNearBottomRef.current = true;
        setIsNearBottom(true);
      });
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
      // Prevent duplicate processing using our new tracking system
      if (processedMessageIds.current.has(message.id)) {
        console.log('♻️ Duplicate message already processed, skipping:', message.id);
        return;
      }
      processedMessageIds.current.add(message.id);

      console.log('📨 Received new message via socket:', {
        id: message.id,
        type: message.type,
        senderId: message.senderId,
        conversationId: message.conversationId,
        content: message.content?.substring(0, 50)
      });

      const activeChat = selectedChatRef.current;
      const currentUserId = user?.id;

      // Simplified routing: message belongs to active chat if conversation IDs match
      const isForActive = activeChat && message.conversationId === activeChat;

      console.log('📨 Message routing:', {
        activeChat,
        currentUserId,
        messageConversationId: message.conversationId,
        isForActive,
        messageSender: message.senderId,
        messageReceiver: message.receiverId
      });

      if (isForActive) {
        setMessages(prev => {
          // Use our deduplication function
          const deduped = deduplicateMessages(prev);

          // Check for duplicates more thoroughly
          const existingMessage = deduped.find(m => m.id === message.id);
          if (existingMessage) {
            console.log('♻️ Duplicate message detected via socket, skipping:', message.id);
            return deduped;
          }

          // Also check if this is replacing a temp message
          const tempMessage = deduped.find(m => m.id.startsWith('temp-') &&
            m.senderId === message.senderId &&
            m.content === message.content);

          if (tempMessage) {
            console.log('🔄 Replacing temp message with real message:', tempMessage.id, '→', message.id);
            return deduped.map(m => m.id === tempMessage.id ? message : m);
          }

          const updated = [...deduped, message];
          console.log('📨 Added new message to active chat via socket, total:', updated.length);
          return updated;
        });
        // Auto-scroll if user is near bottom or message is mine
        if (isNearBottomRef.current || message.senderId === currentUserId) {
          setTimeout(() => performAutoScroll(true), 50);
        }
        if (message.receiverId === currentUserId) {
          setTimeout(() => connectXAPI.markMessageAsRead(message.id).catch(() => { }), 800);
        }
      } else {
        // Increment unread for that conversation
        const targetConv = conversations.find(conv =>
          (message.senderId === conv.participant.id && message.receiverId === currentUserId) ||
          (message.receiverId === conv.participant.id && message.senderId === currentUserId)
        );
        if (targetConv) {
          console.log('📨 Incrementing unread for conversation:', targetConv.id);
          setUnreadCounts(u => ({ ...u, [targetConv.id]: (u[targetConv.id] || 0) + 1 }));
        }
      }
      updateConversationLocally(message);
    });

    socketService.on('message-read', ({ messageId, userId, readAt }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isRead: true, readAt: readAt || new Date().toISOString() } : m));
    });

    socketService.on('user-typing', ({ userId, conversationId }) => {
      console.log('⌨️ User typing event:', { userId, conversationId, activeChat: selectedChatRef.current });
      if (conversationId === selectedChatRef.current && userId !== user?.id) {
        console.log('⌨️ Setting typing indicator ON');
        setIsTyping(true);
        typingTimeoutRef.current && clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          console.log('⌨️ Typing timeout reached, setting OFF');
          setIsTyping(false);
        }, 2500);
      }
    });

    socketService.on('user-stopped-typing', ({ userId, conversationId }) => {
      console.log('⌨️ User stopped typing event:', { userId, conversationId, activeChat: selectedChatRef.current });
      if (conversationId === selectedChatRef.current && userId !== user?.id) {
        console.log('⌨️ Setting typing indicator OFF');
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
      socketService.sendTyping(selectedConv.id, false);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticMessage: Message = {
        id: tempId,
        conversationId: selectedConv.id,
        content: messageContent,
        type: 'TEXT',
        senderId: user!.id,
        receiverId: selectedConv.participant.id,
        createdAt: new Date().toISOString(),
        sender: user!,
        isRead: false,
      } as Message;
      setMessages(prev => [...prev, optimisticMessage]);
      // Immediate scroll after adding optimistic message
      setTimeout(() => performAutoScroll(false), 10);

      // Send message via HTTP API (this will also emit via socket on server side)
      const message = await connectXAPI.sendMessage(selectedConv.id, selectedConv.participant.id, messageContent);

      // Track this message to prevent duplicate processing
      processedMessageIds.current.add(message.id);

      // Replace optimistic message and ensure no duplicates
      setMessages(prev => {
        // Use deduplication function first
        const deduped = deduplicateMessages(prev);

        // Filter out the temp message
        const withoutTemp = deduped.filter(m => m.id !== tempId);

        // Check if real message already exists (from socket)
        if (withoutTemp.find(m => m.id === message.id)) {
          console.log('♻️ Real message already exists from socket, just removing temp');
          return withoutTemp;
        }

        // Add the real message
        console.log('📨 Adding real message from HTTP API response');
        return [...withoutTemp, message];
      });
      updateConversationLocally(message);
      // Force scroll to newest message using inverted FlatList logic
      setTimeout(() => performAutoScroll(true), 100);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
      setNewMessage(messageContent);
      // Remove optimistic temp
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
    } finally {
      setIsSending(false);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access camera roll is required!');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setShowImagePicker(false);
      await sendImageMessage(result.assets[0].uri, result.assets[0].fileName);
    }
  };

  const takePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access camera is required!');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setShowImagePicker(false);
      await sendImageMessage(result.assets[0].uri, result.assets[0].fileName);
    }
  };

  const sendImageMessage = async (imageUri: string, fileName?: string) => {
    const selectedConv = conversations.find(c => c.id === selectedChat);
    if (!selectedConv || isSending) return;

    setIsSending(true);
    try {
      // Create optimistic image message
      const tempId = `temp-img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticMessage: Message = {
        id: tempId,
        conversationId: selectedConv.id,
        content: undefined,
        type: 'IMAGE',
        senderId: user!.id,
        receiverId: selectedConv.participant.id,
        imageUrl: imageUri, // Show local image immediately
        createdAt: new Date().toISOString(),
        sender: user!,
        isRead: false,
      } as Message;

      setMessages(prev => [...prev, optimisticMessage]);
      setTimeout(() => performAutoScroll(false), 10);

      // Send image to server
      const message = await connectXAPI.sendImageMessage(selectedConv.id, selectedConv.participant.id, imageUri, fileName);

      // Replace optimistic message with server response
      setMessages(prev => prev.map(m => m.id === tempId ? message : m));
      updateConversationLocally(message);
      setTimeout(() => performAutoScroll(true), 100);

    } catch (error: any) {
      console.error('Failed to send image:', error);
      Alert.alert('Error', 'Failed to send image');
      // Remove failed optimistic message
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-img-')));
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
    performAutoScroll(true);
    setIsNearBottom(true); // User manually scrolled to bottom
  };

  // Check if user is near the bottom (top of inverted list) of the conversation
  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // For inverted FlatList, "bottom" means near offset 0
    const paddingToTop = 120;
    const isAtBottom = contentOffset.y <= paddingToTop; // Near top of inverted list = bottom of chat
    if (isAtBottom !== isNearBottomRef.current) {
      isNearBottomRef.current = isAtBottom;
      setIsNearBottom(isAtBottom);
      console.log('📍 Scroll position changed, near bottom (inverted):', isAtBottom);
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
        styles.messageWrapper,
        isMyMessage ? styles.myMessageWrapper : styles.otherMessageWrapper
      ]}>
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
            <TouchableOpacity
              onPress={() => {
                const imageUrl = item.imageUrl?.startsWith('http')
                  ? item.imageUrl
                  : `https://tre.dextron04.in${item.imageUrl}`;
                setSelectedImage(imageUrl);
              }}
              style={styles.imageMessageContainer}
            >
              <Image
                source={{
                  uri: item.imageUrl?.startsWith('http')
                    ? item.imageUrl
                    : `https://tre.dextron04.in${item.imageUrl}`
                }}
                style={styles.messageImage}
                resizeMode="cover"
                onError={() => console.log('Failed to load message image:', item.imageUrl)}
              />
            </TouchableOpacity>
          )}

          {item.type === 'FILE' && (
            <Text style={[
              styles.messageContent,
              isMyMessage ? styles.myMessageText : styles.otherMessageText
            ]}>
              📎 {item.fileName || 'File'}
            </Text>
          )}
        </View>
        
        {/* Time and status outside the bubble */}
        <View style={[
          styles.messageTimeContainer,
          isMyMessage ? styles.myMessageTimeContainer : styles.otherMessageTimeContainer
        ]}>
          <Text style={styles.messageTimeText}>
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
              data={messages.slice().reverse()} // Reverse for inverted display
              keyExtractor={item => getStableMessageKey(item)}
              renderItem={renderMessageItem}
              style={styles.messagesList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.messagesContainer}
              removeClippedSubviews={false}
              inverted // This makes newest messages appear at bottom
              onScroll={handleScroll}
              scrollEventThrottle={32}
              onContentSizeChange={(width, height) => {
                contentSizeRef.current = { width, height };
                // With inverted, we don't need aggressive scrolling
                // New messages automatically appear at bottom
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
              <TouchableOpacity
                style={styles.attachButton}
                onPress={() => setShowImagePicker(true)}
              >
                <Text style={styles.attachButtonText}>📷</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.textInput}
                value={newMessage}
                onChangeText={(text) => {
                  setNewMessage(text);
                  if (selectedConv) {
                    // Debounce typing indicator
                    typingDebounceRef.current && clearTimeout(typingDebounceRef.current);
                    const isTyping = text.trim().length > 0;

                    if (isTyping) {
                      socketService.sendTyping(selectedConv.id, true);
                    }

                    typingDebounceRef.current = setTimeout(() => {
                      socketService.sendTyping(selectedConv.id, false);
                    }, 1000);
                  }
                }}
                placeholder="Type a message..."
                placeholderTextColor="#6B7280"
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

      {/* Image Picker Modal */}
      <Modal
        visible={showImagePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImagePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.imagePickerModal}>
            <Text style={styles.modalTitle}>Add Photo</Text>
            <TouchableOpacity style={styles.imagePickerOption} onPress={takePhoto}>
              <Text style={styles.imagePickerOptionText}>📷 Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imagePickerOption} onPress={pickImage}>
              <Text style={styles.imagePickerOptionText}>🖼️ Choose from Library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.imagePickerOption, styles.cancelOption]}
              onPress={() => setShowImagePicker(false)}
            >
              <Text style={[styles.imagePickerOptionText, styles.cancelText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Image Viewer Modal */}
      <Modal
        visible={!!selectedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <View style={styles.imageViewerModal}>
          <TouchableOpacity
            style={styles.imageViewerClose}
            onPress={() => setSelectedImage(null)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
          {selectedImage && (
            <Image
              source={{ uri: selectedImage }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.mutedForeground,
    fontWeight: theme.typography.fontWeights.medium,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.foreground,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  libraryButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.success,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.sm,
  },
  libraryText: {
    fontSize: 16,
  },
  notificationButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: '#8B5CF6',
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.sm,
  },
  notificationText: {
    fontSize: 16,
  },
  settingsButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: '#6B7280',
    borderRadius: theme.borderRadius.sm,
    ...theme.shadows.sm,
  },
  settingsText: {
    color: theme.colors.foreground,
    fontWeight: theme.typography.fontWeights.semibold,
    fontSize: theme.typography.fontSizes.sm,
  },
  logoutButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.sm,
    ...theme.shadows.sm,
  },
  logoutText: {
    color: theme.colors.foreground,
    fontWeight: theme.typography.fontWeights.semibold,
    fontSize: theme.typography.fontSizes.sm,
  },
  conversationsList: {
    flex: 1,
    backgroundColor: theme.colors.sidebar,
  },
  panelTitle: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.sidebarForeground,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.sidebarBorder,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.sidebarBorder,
    borderRadius: theme.borderRadius.md,
    marginHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs / 2,
  },
  selectedConversation: {
    backgroundColor: theme.colors.primary + '20',
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: theme.spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  avatarText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.online,
    borderWidth: 2,
    borderColor: theme.colors.background,
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
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.sidebarForeground,
    flex: 1,
  },
  messageTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.xs / 2,
    paddingHorizontal: theme.spacing.xs,
  },
  myMessageTimeContainer: {
    justifyContent: 'flex-end',
  },
  otherMessageTimeContainer: {
    justifyContent: 'flex-start',
  },
  messageTimeText: {
    fontSize: theme.typography.fontSizes.xs - 1,
    color: theme.colors.textMuted,
    opacity: 0.7,
  },
  readStatus: {
    fontSize: theme.typography.fontSizes.xs - 1,
    marginLeft: theme.spacing.xs,
    opacity: 0.7,
  },
  readStatusRead: {
    color: theme.colors.success,
  },
  readStatusUnread: {
    color: theme.colors.textMuted,
  },
  unreadBadge: {
    backgroundColor: theme.colors.error,
    minWidth: 22,
    paddingHorizontal: theme.spacing.xs,
    height: 22,
    borderRadius: theme.borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing.sm,
    ...theme.shadows.sm,
  },
  unreadText: {
    color: theme.colors.foreground,
    fontSize: theme.typography.fontSizes.xs,
    fontWeight: theme.typography.fontWeights.bold,
  },
  lastMessage: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.sidebar,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.sidebarBorder,
    ...theme.shadows.sm,
  },
  backButton: {
    paddingRight: theme.spacing.lg,
  },
  backButtonText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.primary,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderTitle: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.sidebarForeground,
  },
  onlineStatus: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.online,
  },
  offlineStatus: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
  },
  chatContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
  },
  messagesContainer: {
    paddingVertical: theme.spacing.lg,
  },
  messageWrapper: {
    marginVertical: theme.spacing.xs,
    maxWidth: '75%',
  },
  messageContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.xl,
  },
  myMessageWrapper: {
    alignSelf: 'flex-end',
    marginLeft: theme.spacing['2xl'],
  },
  otherMessageWrapper: {
    alignSelf: 'flex-start',
    marginRight: theme.spacing['2xl'],
  },
  myMessage: {
    backgroundColor: theme.colors.primary,
  },
  otherMessage: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  senderName: {
    fontSize: theme.typography.fontSizes.xs,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  messageContent: {
    fontSize: theme.typography.fontSizes.base,
    marginBottom: theme.spacing.xs,
    lineHeight: theme.typography.lineHeights.normal * theme.typography.fontSizes.base,
  },
  myMessageText: {
    color: theme.colors.primaryForeground,
  },
  otherMessageText: {
    color: theme.colors.foreground,
  },
  typingIndicator: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  typingText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  messageInput: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.sidebarBorder,
    backgroundColor: theme.colors.sidebar,
    gap: theme.spacing.sm,
    ...theme.shadows.md,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    maxHeight: 100,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.input,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm + 2,
    ...theme.shadows.sm,
  },
  disabledSendButton: {
    backgroundColor: theme.colors.textMuted,
  },
  sendButtonText: {
    color: theme.colors.primaryForeground,
    fontWeight: theme.typography.fontWeights.semibold,
    fontSize: theme.typography.fontSizes.base,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing['3xl'] + theme.spacing.sm,
  },
  emptyStateText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
    fontWeight: theme.typography.fontWeights.medium,
  },
  emptyStateSubtext: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
    opacity: 0.8,
  },
  // Image message styles
  imageMessageContainer: {
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
    marginBottom: theme.spacing.xs,
  },
  messageImage: {
    width: 180,
    height: 135,
    borderRadius: theme.borderRadius.lg,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius['2xl'],
    backgroundColor: theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  attachButtonText: {
    fontSize: 18,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  imagePickerModal: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing['3xl'] - theme.spacing.xs,
    ...theme.shadows.lg,
  },
  modalTitle: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
    color: theme.colors.foreground,
  },
  imagePickerOption: {
    paddingVertical: theme.spacing.lg - 1,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm + 2,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  imagePickerOptionText: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    textAlign: 'center',
    color: theme.colors.foreground,
  },
  cancelOption: {
    backgroundColor: theme.colors.error + '20',
    borderColor: theme.colors.error + '40',
  },
  cancelText: {
    color: theme.colors.error,
  },
  imageViewerModal: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 50,
    right: theme.spacing.xl,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius['2xl'],
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.md,
  },
  closeButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
  },
  fullScreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.8,
  },
});