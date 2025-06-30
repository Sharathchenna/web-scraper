import { test, expect } from '@jest/globals';
import { Page, Locator } from 'playwright';
import { AuthEngine, AuthConfig } from '../src/processors/auth-engine';
import { createLogger } from '../src/utils/logger';

jest.mock('playwright', () => ({
  Page: jest.fn(),
  Locator: jest.fn()
}));

// Mock Playwright Page
const mockPage = {
  locator: jest.fn(),
  waitForTimeout: jest.fn(),
  waitForLoadState: jest.fn(),
  url: jest.fn(),
  goto: jest.fn(),
} as unknown as jest.Mocked<Page>;

// Mock locator functions
const mockLocator = {
  first: jest.fn(),
  isVisible: jest.fn(),
  getAttribute: jest.fn(),
  fill: jest.fn(),
  click: jest.fn(),
} as unknown as jest.Mocked<Locator>;

describe('AuthEngine', () => {
  let authEngine: AuthEngine;
  let logger: any;
  let config: AuthConfig;

  beforeEach(() => {
    logger = createLogger();
    config = {
      username: 'test_user',
      password: 'test_pass',
      maxAttempts: 1,
      networkTimeout: 5000,
      throttleMs: 100,
    };
    authEngine = new AuthEngine(logger, config);

    // Reset mocks
    jest.clearAllMocks();
    (mockPage.locator as jest.Mock).mockReturnValue(mockLocator);
    (mockLocator.first as jest.Mock).mockResolvedValue(mockLocator);
  });

  test('should detect and handle login form', async () => {
    // Mock form detection
    (mockLocator.isVisible as jest.Mock).mockResolvedValueOnce(true);
    (mockLocator.getAttribute as jest.Mock).mockResolvedValueOnce('csrf_token_123');

    // Mock successful login
    (mockLocator.fill as jest.Mock).mockResolvedValue(undefined);
    (mockLocator.click as jest.Mock).mockResolvedValue(undefined);
    (mockPage.waitForLoadState as jest.Mock).mockResolvedValue(undefined);

    const result = await authEngine.handleAuthentication(mockPage);

    expect(result.success).toBe(true);
    expect(result.interactions).toContain('Found login form');
    expect(result.interactions).toContain('Successfully logged in');
    expect(mockLocator.fill).toHaveBeenCalledWith('test_user');
    expect(mockLocator.fill).toHaveBeenCalledWith('test_pass');
  });

  test('should handle missing login form', async () => {
    // Mock no form found
    (mockLocator.isVisible as jest.Mock).mockResolvedValue(false);

    const result = await authEngine.handleAuthentication(mockPage);

    expect(result.success).toBe(false);
    expect(result.interactions).toHaveLength(0);
  });

  test('should handle login failure', async () => {
    // Mock form detection
    (mockLocator.isVisible as jest.Mock).mockResolvedValueOnce(true);
    (mockLocator.getAttribute as jest.Mock).mockResolvedValueOnce(null);

    // Mock failed login
    (mockLocator.fill as jest.Mock).mockRejectedValue(new Error('Failed to fill input'));

    const result = await authEngine.handleAuthentication(mockPage);

    expect(result.success).toBe(false);
    expect(result.interactions).toContain('Found login form');
    expect(result.interactions).toContain('Login failed: Failed to fill input');
  });

  test('should respect maxAttempts config', async () => {
    // Set maxAttempts to 2
    config.maxAttempts = 2;
    authEngine = new AuthEngine(logger, config);

    // Mock form detection for both attempts
    (mockLocator.isVisible as jest.Mock).mockResolvedValue(true);
    (mockLocator.getAttribute as jest.Mock).mockResolvedValue(null);

    // Mock failed login attempts
    (mockLocator.fill as jest.Mock).mockRejectedValue(new Error('Failed to fill input'));

    const result = await authEngine.handleAuthentication(mockPage);

    expect(result.success).toBe(false);
    expect(result.interactions).toHaveLength(4); // 2 attempts * 2 messages per attempt
    expect(mockLocator.fill).toHaveBeenCalledTimes(2);
  });

  test('should handle CSRF token', async () => {
    // Mock form detection with CSRF token
    (mockLocator.isVisible as jest.Mock).mockResolvedValueOnce(true);
    (mockLocator.getAttribute as jest.Mock).mockResolvedValueOnce('csrf_token_123');

    // Mock successful login
    (mockLocator.fill as jest.Mock).mockResolvedValue(undefined);
    (mockLocator.click as jest.Mock).mockResolvedValue(undefined);
    (mockPage.waitForLoadState as jest.Mock).mockResolvedValue(undefined);

    const result = await authEngine.handleAuthentication(mockPage);

    expect(result.success).toBe(true);
    expect(result.interactions).toContain('Found login form with CSRF token');
    expect(mockLocator.fill).toHaveBeenCalledWith('test_user');
    expect(mockLocator.fill).toHaveBeenCalledWith('test_pass');
  });
}); 