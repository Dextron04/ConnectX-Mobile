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

interface SharedImage {
  id: string;
  fileName: string;
  originalName: string;
  url: string;
  status: 'PENDING' | 'VIEWED' | 'DOWNLOADED';
  createdAt: string;
  sender: {
    id: string;
    username: string;
  };
  receiver: {
    id: string;
    username: string;
  };
}

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
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'library' | 'settings'>('chats');

  // Digital Library states
  const [sharedImages, setSharedImages] = useState<SharedImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selectedLibraryImage, setSelectedLibraryImage] = useState<SharedImage | null>(null);
  const [libraryTab, setLibraryTab] = useState<'all' | 'sent' | 'received'>('all');

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

  // Load conversations and unread counts when conversations change
  useEffect(() => {
    if (conversations.length > 0 && user?.id) {
      console.log('🔄 Conversations loaded, fetching unread counts...');
      loadUnreadCounts();
    }
  }, [conversations, user?.id]);

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

      // Reset unread for this conversation with a small delay to ensure state is updated
      const markAsRead = async () => {
        setTimeout(() => {
          setUnreadCounts(prevCounts => {
            const currentUnread = prevCounts[selectedChat] || 0;
            if (currentUnread > 0) {
              console.log(`🔄 Resetting unread count for ${selectedChat}: ${currentUnread} -> 0`);
              setTotalUnreadCount(prevTotal => {
                const newTotal = Math.max(0, prevTotal - currentUnread);
                console.log('📉 Total unread count after reset:', prevTotal, '->', newTotal);
                return newTotal;
              });
              return { ...prevCounts, [selectedChat]: 0 };
            }
            return prevCounts;
          });
        }, 100); // Small delay to ensure UI updates
      };

      markAsRead();

      return () => {
        console.log('🚪 Leaving conversation:', selectedChat);
        socketService.leaveConversation(selectedChat);
      };
    }
  }, [selectedChat]); // depend only on selectedChat to avoid infinite loops

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

  const loadUnreadCounts = async () => {
    if (conversations.length === 0 || !user?.id) return;

    try {
      console.log('🔍 Loading unread counts for', conversations.length, 'conversations');
      const counts: Record<string, number> = {};
      let totalUnread = 0;

      for (const conv of conversations) {
        try {
          const messages = await connectXAPI.getMessages(conv.id);
          const unreadMessages = messages.filter(m =>
            m.receiverId === user.id && !m.isRead
          );

          const unreadCount = unreadMessages.length;
          if (unreadCount > 0) {
            counts[conv.id] = unreadCount;
            totalUnread += unreadCount;
            console.log(`📊 Conversation ${conv.participant.username} (${conv.id}): ${unreadCount} unread`);
          }
        } catch (error) {
          console.log('Could not get messages for conversation:', conv.id, error);
        }
      }

      console.log('✅ Final unread counts:', counts);
      console.log('✅ Total unread:', totalUnread);

      setUnreadCounts(counts);
      setTotalUnreadCount(totalUnread);
    } catch (error) {
      console.log('❌ Failed to load unread counts:', error);
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
        // Only increment unread if this is a message TO the current user (not from them)
        if (message.receiverId === currentUserId && message.senderId !== currentUserId) {
          console.log('🚨 NEW UNREAD MESSAGE - Incrementing count');
          console.log('Message details:', {
            id: message.id,
            from: message.senderId,
            to: message.receiverId,
            currentUser: currentUserId,
            conversationId: message.conversationId
          });

          // Find the conversation for this message
          const targetConv = conversations.find(conv =>
            conv.id === message.conversationId
          );

          if (targetConv) {
            console.log('🎯 Found target conversation:', targetConv.participant.username, targetConv.id);

            setUnreadCounts(prevCounts => {
              const currentCount = prevCounts[targetConv.id] || 0;
              const newCount = currentCount + 1;
              console.log(`🔥 UNREAD COUNT UPDATE: ${targetConv.participant.username} (${targetConv.id})`);
              console.log(`   Previous count: ${currentCount}`);
              console.log(`   New count: ${newCount}`);
              console.log(`   All counts:`, { ...prevCounts, [targetConv.id]: newCount });
              return { ...prevCounts, [targetConv.id]: newCount };
            });

            setTotalUnreadCount(prevTotal => {
              const newTotal = prevTotal + 1;
              console.log(`🔥 TOTAL UNREAD UPDATE: ${prevTotal} -> ${newTotal}`);
              return newTotal;
            });
          } else {
            console.log('❌ Could not find conversation for message:', message.conversationId);
            console.log('Available conversations:', conversations.map(c => ({ id: c.id, name: c.participant.username })));
          }
        } else {
          console.log('ℹ️ Message not counted as unread:', {
            reason: message.receiverId !== currentUserId ? 'Not for current user' : 'From current user',
            receiverId: message.receiverId,
            senderId: message.senderId,
            currentUserId
          });
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
    const isUnread = unread > 0;

    return (
      <TouchableOpacity
        style={[
          styles.conversationItem,
          selectedChat === item.id && styles.selectedConversation,
          isUnread && styles.unreadConversation
        ]}
        onPress={() => setSelectedChat(item.id)}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, isUnread && styles.unreadAvatar]}>
            <Text style={styles.avatarText}>
              {item.participant.username?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          {item.participant.isOnline && <View style={styles.onlineIndicator} />}
          {isUnread && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.username, isUnread && styles.unreadUsername]} numberOfLines={1}>
              {item.participant.username}
            </Text>
            {item.lastMessage && (
              <Text style={[styles.messageTime, isUnread && styles.unreadMessageTime]}>
                {formatLastMessageTime(item.lastMessage.createdAt)}
              </Text>
            )}
          </View>
          {item.lastMessage && (
            <Text style={[styles.lastMessage, isUnread && styles.unreadLastMessage]} numberOfLines={1}>
              {item.lastMessage.type === 'IMAGE' ? '📷 Image' :
                item.lastMessage.type === 'FILE' ? '📎 File' :
                  item.lastMessage.content || 'Message'}
            </Text>
          )}
        </View>
        {isUnread && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {unread > 99 ? '99+' : unread.toString()}
            </Text>
          </View>
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

  const renderTabContent = () => {
    if (selectedChat) {
      // Show individual chat view
      return renderChatView();
    }

    switch (activeTab) {
      case 'chats':
        return renderChatsTab();
      case 'library':
        return renderLibraryTab();
      case 'settings':
        return renderSettingsTab();
      default:
        return renderChatsTab();
    }
  };

  const renderChatsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.conversationsList}>
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversationItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.conversationsContainer}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No conversations yet</Text>
              <Text style={styles.emptyStateSubtext}>Start a new conversation to begin chatting</Text>
            </View>
          }
        />
      </View>
    </View>
  );

  const loadLibraryImages = async () => {
    // Only load if we're on the library tab
    if (activeTab !== 'library') {
      return;
    }

    try {
      setLibraryLoading(true);
      const allImages = await connectXAPI.getSharedImages();

      let filteredImages = allImages;
      if (libraryTab === 'sent') {
        filteredImages = allImages.filter(img => img.sender.id === user?.id);
      } else if (libraryTab === 'received') {
        filteredImages = allImages.filter(img => img.receiver.id === user?.id);
      }

      setSharedImages(filteredImages);
    } catch (error: any) {
      console.error('Failed to load library images:', error);
    } finally {
      setLibraryLoading(false);
    }
  };

  // Load library images when tab becomes active or library filter changes
  useEffect(() => {
    if (activeTab === 'library') {
      loadLibraryImages();
    }
  }, [activeTab, libraryTab, user?.id]);

  const getImageStatusBadge = (image: SharedImage) => {
    if (image.sender.id === user?.id) {
      switch (image.status) {
        case 'PENDING':
          return { text: 'Not viewed', color: theme.colors.textMuted };
        case 'VIEWED':
          return { text: 'Viewed', color: theme.colors.primary };
        case 'DOWNLOADED':
          return { text: 'Downloaded', color: theme.colors.success };
      }
    } else {
      switch (image.status) {
        case 'PENDING':
          return { text: 'New', color: theme.colors.error };
        case 'VIEWED':
          return { text: 'Viewed', color: theme.colors.primary };
        case 'DOWNLOADED':
          return { text: 'Downloaded', color: theme.colors.success };
      }
    }
    return { text: 'Unknown', color: theme.colors.textMuted };
  };

  const renderLibraryImageItem = ({ item }: { item: SharedImage }) => {
    const statusBadge = getImageStatusBadge(item);
    const isMyImage = item.sender.id === user?.id;
    const imageUrl = item.url.startsWith('http') ? item.url : `https://tre.dextron04.in${item.url}`;

    return (
      <TouchableOpacity
        style={styles.libraryImageItem}
        onPress={() => setSelectedLibraryImage(item)}
      >
        <Image
          source={{ uri: imageUrl }}
          style={styles.libraryImageThumb}
          onError={(error) => console.error('Image load error:', error.nativeEvent.error)}
        />
        <View style={styles.libraryImageInfo}>
          <Text style={styles.libraryImageName} numberOfLines={1}>
            {item.originalName}
          </Text>
          <Text style={styles.libraryImageUser}>
            {isMyImage ? `To: ${item.receiver.username}` : `From: ${item.sender.username}`}
          </Text>
          <View style={styles.libraryImageFooter}>
            <Text style={styles.libraryImageDate}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
            <View style={[styles.libraryStatusBadge, { backgroundColor: statusBadge.color }]}>
              <Text style={styles.libraryStatusText}>{statusBadge.text}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderLibraryTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.libraryContent}>
        <Text style={styles.tabTitle}>Digital Library</Text>
        <Text style={styles.tabSubtitle}>Your shared images and files</Text>

        {/* Library Filter Tabs */}
        <View style={styles.libraryTabContainer}>
          <TouchableOpacity
            style={[styles.libraryTabItem, libraryTab === 'all' && styles.activeLibraryTabItem]}
            onPress={() => setLibraryTab('all')}
          >
            <Text style={[styles.libraryTabText, libraryTab === 'all' && styles.activeLibraryTabText]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.libraryTabItem, libraryTab === 'sent' && styles.activeLibraryTabItem]}
            onPress={() => setLibraryTab('sent')}
          >
            <Text style={[styles.libraryTabText, libraryTab === 'sent' && styles.activeLibraryTabText]}>
              Sent
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.libraryTabItem, libraryTab === 'received' && styles.activeLibraryTabItem]}
            onPress={() => setLibraryTab('received')}
          >
            <Text style={[styles.libraryTabText, libraryTab === 'received' && styles.activeLibraryTabText]}>
              Received
            </Text>
          </TouchableOpacity>
        </View>

        {/* Images Grid */}
        {libraryLoading ? (
          <View style={styles.libraryLoadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.libraryLoadingText}>Loading images...</Text>
          </View>
        ) : (
          <FlatList
            data={sharedImages}
            keyExtractor={(item) => item.id}
            renderItem={renderLibraryImageItem}
            numColumns={2}
            contentContainerStyle={styles.libraryImagesList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.libraryEmptyState}>
                <Text style={styles.libraryEmptyIcon}>🖼️</Text>
                <Text style={styles.libraryEmptyText}>No images found</Text>
                <Text style={styles.libraryEmptySubtext}>
                  {libraryTab === 'sent' && "You haven't shared any images yet."}
                  {libraryTab === 'received' && "You haven't received any images yet."}
                  {libraryTab === 'all' && "No images to display."}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </View>
  );

  const renderSettingsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.settingsContent}>
        <Text style={styles.tabTitle}>Settings</Text>

        <View style={styles.settingsList}>
          <TouchableOpacity
            style={styles.settingsItem}
            onPress={() => navigation.navigate('Settings' as never)}
          >
            <View style={styles.settingsIcon}>
              <Text style={styles.settingsIconText}>⚙️</Text>
            </View>
            <View style={styles.settingsItemContent}>
              <Text style={styles.settingsItemTitle}>App Settings</Text>
              <Text style={styles.settingsItemSubtitle}>Server configuration and preferences</Text>
            </View>
            <Text style={styles.settingsChevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsItem}
            onPress={() => navigation.navigate('NotificationSettings' as never)}
          >
            <View style={styles.settingsIcon}>
              <Text style={styles.settingsIconText}>🔔</Text>
            </View>
            <View style={styles.settingsItemContent}>
              <Text style={styles.settingsItemTitle}>Notifications</Text>
              <Text style={styles.settingsItemSubtitle}>Manage notification preferences</Text>
            </View>
            <Text style={styles.settingsChevron}>›</Text>
          </TouchableOpacity>


          <TouchableOpacity style={[styles.settingsItem, styles.dangerItem]} onPress={handleLogout}>
            <View style={styles.settingsIcon}>
              <Text style={styles.settingsIconText}>🚪</Text>
            </View>
            <View style={styles.settingsItemContent}>
              <Text style={[styles.settingsItemTitle, styles.dangerText]}>Sign Out</Text>
              <Text style={styles.settingsItemSubtitle}>Log out of your account</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (!selectedChat) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>ConnectX</Text>
            {totalUnreadCount > 0 && activeTab === 'chats' && (
              <View style={styles.totalUnreadBadge}>
                <Text style={styles.totalUnreadText}>
                  {totalUnreadCount > 99 ? '99+' : totalUnreadCount.toString()}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Tab Content */}
        {renderTabContent()}

        {/* Bottom Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'chats' && styles.activeTabItem]}
            onPress={() => setActiveTab('chats')}
          >
            <Text style={[styles.tabIcon, activeTab === 'chats' && styles.activeTabIcon]}>💬</Text>
            <Text style={[styles.tabLabel, activeTab === 'chats' && styles.activeTabLabel]}>
              Chats
              {totalUnreadCount > 0 && (
                <Text style={styles.tabBadgeText}> ({totalUnreadCount})</Text>
              )}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'library' && styles.activeTabItem]}
            onPress={() => setActiveTab('library')}
          >
            <Text style={[styles.tabIcon, activeTab === 'library' && styles.activeTabIcon]}>🖼️</Text>
            <Text style={[styles.tabLabel, activeTab === 'library' && styles.activeTabLabel]}>Library</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'settings' && styles.activeTabItem]}
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.tabIcon, activeTab === 'settings' && styles.activeTabIcon]}>⚙️</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.activeTabLabel]}>Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderChatView = () => {
    const selectedConv = conversations.find(c => c.id === selectedChat);

    return (
      <View style={styles.chatViewContainer}>
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
          key={`chat-${selectedChat}-${messages.length}`}
          style={styles.chatContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 50 : 0}
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

              <View style={[styles.messageInput, { paddingBottom: Platform.OS === 'ios' ? 20 : 12 }]}>
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

        {/* Chat Image Viewer Modal */}
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

        {/* Library Image Viewer Modal */}
        <Modal
          visible={!!selectedLibraryImage}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedLibraryImage(null)}
        >
          <View style={styles.libraryModalContainer}>
            <View style={styles.libraryModalContent}>
              <View style={styles.libraryModalHeader}>
                <Text style={styles.libraryModalTitle} numberOfLines={1}>
                  {selectedLibraryImage?.originalName}
                </Text>
                <TouchableOpacity
                  style={styles.libraryCloseButton}
                  onPress={() => setSelectedLibraryImage(null)}
                >
                  <Text style={styles.libraryCloseButtonText}>✕</Text>
                </TouchableOpacity>
              </View>

              {selectedLibraryImage && (
                <>
                  <Image
                    source={{
                      uri: selectedLibraryImage.url.startsWith('http')
                        ? selectedLibraryImage.url
                        : `https://tre.dextron04.in${selectedLibraryImage.url}`
                    }}
                    style={styles.libraryModalImage}
                    resizeMode="contain"
                  />

                  <View style={styles.libraryModalInfo}>
                    <View style={styles.libraryModalUserInfo}>
                      <Text style={styles.libraryModalUserText}>
                        {selectedLibraryImage.sender.id === user?.id
                          ? `Shared with ${selectedLibraryImage.receiver.username}`
                          : `Shared by ${selectedLibraryImage.sender.username}`
                        }
                      </Text>
                      <Text style={styles.libraryModalDate}>
                        {new Date(selectedLibraryImage.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  // Main render
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderTabContent()}
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.foreground,
  },
  totalUnreadBadge: {
    backgroundColor: theme.colors.success,
    minWidth: 20,
    height: 20,
    borderRadius: theme.borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xs,
    ...theme.shadows.sm,
  },
  totalUnreadText: {
    color: theme.colors.foreground,
    fontSize: theme.typography.fontSizes.xs,
    fontWeight: theme.typography.fontWeights.bold,
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
  tabContent: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  conversationsList: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  conversationsContainer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
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
    paddingVertical: theme.spacing.md + 2,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.xl,
    marginVertical: theme.spacing.xs,
    marginHorizontal: theme.spacing.sm,
    ...theme.shadows.sm,
  },
  selectedConversation: {
    backgroundColor: theme.colors.primary,
    transform: [{ scale: 0.98 }],
  },
  unreadConversation: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary + '30',
  },
  unreadAvatar: {
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: theme.colors.success,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
  unreadUsername: {
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.foreground,
  },
  unreadMessageTime: {
    color: theme.colors.success,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  unreadLastMessage: {
    color: theme.colors.foreground,
    fontWeight: theme.typography.fontWeights.medium,
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
  chatViewContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.sidebarBorder,
    backgroundColor: theme.colors.sidebar,
    gap: theme.spacing.sm,
    ...theme.shadows.md,
    minHeight: 60,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    maxHeight: 100,
    minHeight: 38,
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.input,
    textAlignVertical: 'center',
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
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
    width: 38,
    height: 38,
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

  // Tab Bar Styles
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.borderLight,
    paddingBottom: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    ...theme.shadows.md,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
  },
  activeTabItem: {
    backgroundColor: theme.colors.primary + '15',
  },
  tabIcon: {
    fontSize: 22,
    marginBottom: theme.spacing.xs / 2,
  },
  activeTabIcon: {
    transform: [{ scale: 1.1 }],
  },
  tabLabel: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
    fontWeight: theme.typography.fontWeights.medium,
  },
  activeTabLabel: {
    color: theme.colors.primary,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  tabBadgeText: {
    color: theme.colors.primary,
    fontWeight: theme.typography.fontWeights.bold,
  },

  // Library Tab Styles
  libraryContent: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing['2xl'],
  },
  libraryTabContainer: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  libraryTabItem: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderRadius: theme.borderRadius.md,
  },
  activeLibraryTabItem: {
    backgroundColor: theme.colors.primary,
  },
  libraryTabText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
    fontWeight: theme.typography.fontWeights.medium,
  },
  activeLibraryTabText: {
    color: theme.colors.primaryForeground,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  libraryLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing['3xl'],
  },
  libraryLoadingText: {
    fontSize: theme.typography.fontSizes.base,
    color: theme.colors.textMuted,
  },
  libraryImagesList: {
    paddingBottom: theme.spacing.lg,
  },
  libraryImageItem: {
    flex: 0.48,
    marginBottom: theme.spacing.lg,
    marginHorizontal: '1%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
    ...theme.shadows.sm,
  },
  libraryImageThumb: {
    width: '100%',
    height: 120,
    backgroundColor: theme.colors.muted,
  },
  libraryImageInfo: {
    padding: theme.spacing.md,
  },
  libraryImageName: {
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.xs / 2,
  },
  libraryImageUser: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  libraryImageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  libraryImageDate: {
    fontSize: theme.typography.fontSizes.xs - 1,
    color: theme.colors.textMuted,
  },
  libraryStatusBadge: {
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  libraryStatusText: {
    fontSize: theme.typography.fontSizes.xs - 1,
    color: theme.colors.foreground,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  libraryEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing['3xl'] * 2,
  },
  libraryEmptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.lg,
  },
  libraryEmptyText: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  libraryEmptySubtext: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
    opacity: 0.8,
  },
  libraryModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryModalContent: {
    width: Dimensions.get('window').width - theme.spacing['3xl'],
    maxHeight: '90%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
  },
  libraryModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  libraryModalTitle: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    flex: 1,
  },
  libraryCloseButton: {
    padding: theme.spacing.sm,
    marginLeft: theme.spacing.sm,
  },
  libraryCloseButtonText: {
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.textMuted,
    fontWeight: theme.typography.fontWeights.bold,
  },
  libraryModalImage: {
    width: '100%',
    height: 300,
    backgroundColor: theme.colors.muted,
  },
  libraryModalInfo: {
    padding: theme.spacing.lg,
  },
  libraryModalUserInfo: {
    marginBottom: theme.spacing.lg,
  },
  libraryModalUserText: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.xs / 2,
  },
  libraryModalDate: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
  },

  // Settings Tab Styles
  settingsContent: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing['2xl'],
  },
  settingsList: {
    flex: 1,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md + 2,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.xl,
    marginVertical: theme.spacing.xs,
    ...theme.shadows.sm,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  settingsIconText: {
    fontSize: 18,
  },
  settingsItemContent: {
    flex: 1,
  },
  settingsItemTitle: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing.xs / 2,
  },
  settingsItemSubtitle: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
  },
  settingsChevron: {
    fontSize: 20,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
  },
  dangerItem: {
    marginTop: theme.spacing.lg,
  },
  dangerText: {
    color: theme.colors.error,
  },

  // Missing styles
  messageTime: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs / 2,
  },
  tabTitle: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.foreground,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  tabSubtitle: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
});