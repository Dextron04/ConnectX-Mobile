// Design system inspired by the main ConnectX web application
export const theme = {
  colors: {
    // Background colors
    background: '#0a0a0a',
    surface: '#18181b',
    card: '#23272a',
    
    // Primary colors
    primary: '#5865f2',
    primaryForeground: '#ffffff',
    
    // Secondary colors
    secondary: '#23272a',
    secondaryForeground: '#ffffff',
    
    // Accent colors
    accent: '#5865f2',
    accentForeground: '#ffffff',
    
    // Muted colors
    muted: '#18181b',
    mutedForeground: '#888888',
    
    // Text colors
    foreground: '#ffffff',
    textSecondary: '#b3b3b3',
    textMuted: '#888888',
    
    // Border colors
    border: '#23272a',
    borderLight: '#2f3136',
    
    // Status colors
    success: '#10b981',
    error: '#ed4245',
    warning: '#f59e0b',
    info: '#3b82f6',
    
    // Online/offline indicators
    online: '#10b981',
    offline: '#6b7280',
    
    // Message colors
    myMessage: '#5865f2',
    otherMessage: '#374151',
    
    // Input colors
    input: '#18181b',
    inputBorder: '#23272a',
    inputFocused: '#5865f2',
    
    // Sidebar colors
    sidebar: '#23272a',
    sidebarForeground: '#ffffff',
    sidebarBorder: '#2f3136',
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
  },
  
  borderRadius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    '2xl': 20,
    full: 9999,
  },
  
  typography: {
    fontSizes: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 32,
    },
    fontWeights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    lineHeights: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.6,
    },
  },
  
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 8,
    },
  },
  
  animations: {
    duration: {
      fast: 150,
      normal: 200,
      slow: 300,
    },
  },
} as const;

export type Theme = typeof theme;