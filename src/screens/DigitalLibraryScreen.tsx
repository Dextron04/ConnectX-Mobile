import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  Modal,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { connectXAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

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

const { width } = Dimensions.get('window');
const imageSize = (width - 48) / 2; // 2 columns with padding

export const DigitalLibraryScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [images, setImages] = useState<SharedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<SharedImage | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'sent' | 'received'>('all');

  useEffect(() => {
    loadImages();
  }, [activeTab]);

  const loadImages = async () => {
    try {
      setLoading(true);
      const allImages = await connectXAPI.getSharedImages();
      
      let filteredImages = allImages;
      if (activeTab === 'sent') {
        filteredImages = allImages.filter(img => img.sender.id === user?.id);
      } else if (activeTab === 'received') {
        filteredImages = allImages.filter(img => img.receiver.id === user?.id);
      }
      
      setImages(filteredImages);
    } catch (error) {
      console.error('Failed to load images:', error);
      Alert.alert('Error', 'Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleImagePress = (image: SharedImage) => {
    setSelectedImage(image);
  };

  const getStatusBadge = (image: SharedImage) => {
    if (image.sender.id === user?.id) {
      switch (image.status) {
        case 'PENDING':
          return { text: 'Not viewed', color: '#6b7280' };
        case 'VIEWED':
          return { text: 'Viewed', color: '#3b82f6' };
        case 'DOWNLOADED':
          return { text: 'Downloaded', color: '#10b981' };
      }
    } else {
      switch (image.status) {
        case 'PENDING':
          return { text: 'New', color: '#ef4444' };
        case 'VIEWED':
          return { text: 'Viewed', color: '#3b82f6' };
        case 'DOWNLOADED':
          return { text: 'Downloaded', color: '#10b981' };
      }
    }
    return { text: 'Unknown', color: '#6b7280' };
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const renderImageItem = ({ item }: { item: SharedImage }) => {
    const statusBadge = getStatusBadge(item);
    const isMyImage = item.sender.id === user?.id;

    return (
      <TouchableOpacity 
        style={styles.imageItem}
        onPress={() => handleImagePress(item)}
      >
        <Image source={{ uri: item.url }} style={styles.imageThumb} />
        <View style={styles.imageInfo}>
          <Text style={styles.imageName} numberOfLines={1}>
            {item.originalName}
          </Text>
          <Text style={styles.imageUser}>
            {isMyImage ? `To: ${item.receiver.username}` : `From: ${item.sender.username}`}
          </Text>
          <View style={styles.imageFooter}>
            <Text style={styles.imageDate}>{formatDate(item.createdAt)}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBadge.color }]}>
              <Text style={styles.statusText}>{statusBadge.text}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTab = (tab: 'all' | 'sent' | 'received', title: string) => (
    <TouchableOpacity
      style={[styles.tab, activeTab === tab && styles.activeTab]}
      onPress={() => setActiveTab(tab)}
    >
      <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Digital Library</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.tabContainer}>
        {renderTab('all', 'All')}
        {renderTab('sent', 'Sent')}
        {renderTab('received', 'Received')}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading images...</Text>
        </View>
      ) : (
        <FlatList
          data={images}
          keyExtractor={(item) => item.id}
          renderItem={renderImageItem}
          numColumns={2}
          contentContainerStyle={styles.imageList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🖼️</Text>
              <Text style={styles.emptyStateText}>No images found</Text>
              <Text style={styles.emptyStateSubtext}>
                {activeTab === 'sent' && "You haven't shared any images yet."}
                {activeTab === 'received' && "You haven't received any images yet."}
                {activeTab === 'all' && "No images to display."}
              </Text>
            </View>
          }
        />
      )}

      {/* Image Modal */}
      <Modal
        visible={!!selectedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {selectedImage?.originalName}
              </Text>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={() => setSelectedImage(null)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {selectedImage && (
              <>
                <Image 
                  source={{ uri: selectedImage.url }} 
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                
                <View style={styles.modalInfo}>
                  <View style={styles.modalUserInfo}>
                    <Text style={styles.modalUserText}>
                      {selectedImage.sender.id === user?.id 
                        ? `Shared with ${selectedImage.receiver.username}`
                        : `Shared by ${selectedImage.sender.username}`
                      }
                    </Text>
                    <Text style={styles.modalDate}>
                      {new Date(selectedImage.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.downloadButton}>
                      <Text style={styles.downloadButtonText}>Download</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  backButton: {
    paddingRight: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  placeholder: {
    width: 60,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#3b82f6',
  },
  tabText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#3b82f6',
    fontWeight: '600',
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
  imageList: {
    padding: 16,
  },
  imageItem: {
    width: imageSize,
    marginBottom: 16,
    marginHorizontal: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  imageThumb: {
    width: '100%',
    height: imageSize * 0.7,
    backgroundColor: '#f3f4f6',
  },
  imageInfo: {
    padding: 12,
  },
  imageName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  imageUser: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  imageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imageDate: {
    fontSize: 11,
    color: '#9ca3af',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    maxWidth: 280,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: width - 32,
    maxHeight: '90%',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  closeButton: {
    padding: 8,
    marginLeft: 8,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: 'bold',
  },
  modalImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#f3f4f6',
  },
  modalInfo: {
    padding: 16,
  },
  modalUserInfo: {
    marginBottom: 16,
  },
  modalUserText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  modalDate: {
    fontSize: 14,
    color: '#6b7280',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  downloadButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  downloadButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});