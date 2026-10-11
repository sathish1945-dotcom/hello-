/**
 * Shared API request and error handling utility for hello frontend.
 * Enforces:
 * 1. HTTP status checks
 * 2. Content-Type validation
 * 3. JSON parsing only when Content-Type is application/json
 * 4. Clean error messages for HTML/text responses (never exposing raw HTML)
 */

export class ApiError extends Error {
  status: number;
  data?: any;
  code?: string;

  constructor(message: string, status: number, data?: any, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

/**
 * Checks whether the response Content-Type is JSON.
 */
export function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return !!contentType && contentType.toLowerCase().includes('application/json');
}

/**
 * Formats a clean error message for non-JSON or HTTP errors.
 * Never exposes raw HTML or text responses to users.
 */
export function formatHttpError(status: number): string {
  if (status === 404) {
    return 'Backend API unavailable (HTTP 404)';
  }
  if (status === 401) {
    return 'Unauthorized request (HTTP 401)';
  }
  if (status === 403) {
    return 'Access forbidden (HTTP 403)';
  }
  if (status >= 500) {
    return `Backend API unavailable (HTTP ${status})`;
  }
  return `Server returned unexpected response (HTTP ${status})`;
}

/**
 * Parses response JSON safely.
 * Only attempts JSON parsing when Content-Type is application/json.
 * For non-JSON (HTML/plain text) or HTTP errors, throws a clean ApiError.
 */
export async function parseApiResponse<T = any>(response: Response): Promise<T> {
  const isJson = isJsonResponse(response);

  // If the server returned HTML or non-JSON content
  if (!isJson) {
    const cleanMessage = formatHttpError(response.status);
    throw new ApiError(cleanMessage, response.status);
  }

  // Parse JSON safely
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(formatHttpError(response.status), response.status);
  }

  // Check HTTP status
  if (!response.ok) {
    const cleanMessage =
      data?.error ||
      data?.message ||
      formatHttpError(response.status);
    throw new ApiError(cleanMessage, response.status, data, data?.code);
  }

  return data as T;
}

/**
 * Safely extracts error details from an HTTP response (e.g. streaming responses).
 * Always returns a clean message and never exposes raw HTML/plain text.
 */
export async function parseApiError(
  response: Response,
  defaultMessage: string = 'Request failed'
): Promise<{ message: string; code?: string; data?: any }> {
  if (!isJsonResponse(response)) {
    return {
      message: formatHttpError(response.status),
    };
  }

  try {
    const data = await response.json();
    return {
      message: data?.error || data?.message || defaultMessage,
      code: data?.code,
      data,
    };
  } catch {
    return {
      message: formatHttpError(response.status),
    };
  }
}

import { Capacitor } from '@capacitor/core';

export const PRODUCTION_API_URL = 'https://model-mesh-taupe.vercel.app';

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  return localStorage.getItem('hello_auth_token');
}

export function setStoredAuthToken(token: string): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && token) {
    localStorage.setItem('hello_auth_token', token);
  }
}

export function clearStoredAuthToken(): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem('hello_auth_token');
  }
}

export function getApiBaseUrl(): string {
  // 1. Vite environment variable (e.g. VITE_API_URL)
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  }

  // 2. Custom override in localStorage (if developer specifies another URL)
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('hello_api_base_url');
    if (custom) return custom.replace(/\/+$/, '');
  }

  // 3. Native Android / Capacitor -> HTTPS Deployed Backend
  if (Capacitor.isNativePlatform()) {
    return PRODUCTION_API_URL;
  }

  // 4. Web browser -> relative requests to current origin
  return '';
}

export function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

/**
 * Shared API fetch wrapper that executes fetch and parses the response.
 */
export async function apiRequest<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  let target: RequestInfo | URL = input;
  if (typeof target === 'string') {
    target = getApiUrl(target);
  }

  const token = getStoredAuthToken();
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const mergedInit: RequestInit = {
    ...init,
    headers,
    credentials: init?.credentials || 'include',
  };
  const response = await fetch(target, mergedInit);
  return parseApiResponse<T>(response);
}
