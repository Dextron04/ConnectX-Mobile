// Server configuration
export const SERVER_CONFIG = {
    // Production server
    BASE_URL: 'https://tre.dextron04.in',
    API_BASE: 'https://tre.dextron04.in/api',
    SOCKET_URL: 'https://tre.dextron04.in',

    // For development, you can uncomment these lines:
    // BASE_URL: 'http://localhost:3456',
    // API_BASE: 'http://localhost:3456/api',
    // SOCKET_URL: 'http://localhost:3456',
} as const;

// Environment detection
export const isDevelopment = __DEV__;
export const isProduction = !__DEV__;

// API timeout
export const API_TIMEOUT = 10000;

// Socket configuration
export const SOCKET_CONFIG = {
    path: '/api/socket/io',
    transports: ['polling', 'websocket'] as string[], // Allow polling fallback
    upgrade: true,
    forceNew: false, // Don't force new connection every time
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
};
