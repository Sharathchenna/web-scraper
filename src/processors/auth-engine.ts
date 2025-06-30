import { Page } from 'playwright';
import type { Logger } from 'winston';

export interface AuthConfig {
  username: string;
  password: string;
  maxAttempts: number;
  networkTimeout: number;
  throttleMs: number;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  interactions: string[];
}

export interface LoginForm {
  formElement: string;
  usernameInput: string;
  passwordInput: string;
  submitButton: string;
  csrfToken?: string;
}

export class AuthEngine {
  private readonly logger: Logger;
  private readonly config: AuthConfig;
  private readonly visitedHosts: Set<string>;

  // Common selectors for login forms
  private static readonly LOGIN_SELECTORS = {
    forms: [
      'form[action*="login"]',
      'form[action*="signin"]',
      'form[action*="auth"]',
      'form[id*="login"]',
      'form[class*="login"]',
      'form:has(input[type="password"])'
    ],
    usernameInputs: [
      'input[type="text"][name*="user"]',
      'input[type="email"]',
      'input[name*="login"]',
      'input[name*="email"]',
      'input[autocomplete="username"]'
    ],
    passwordInputs: [
      'input[type="password"]'
    ],
    submitButtons: [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Login")'
    ],
    csrfTokens: [
      'input[name*="csrf"]',
      'input[name*="token"]',
      'meta[name="csrf-token"]'
    ]
  };

  constructor(logger: Logger, config: Partial<AuthConfig> = {}) {
    this.logger = logger;
    this.config = {
      username: process.env.SMART_DISCOVERY_TEST_USER || 'test_user',
      password: process.env.SMART_DISCOVERY_TEST_PASS || 'test_pass',
      maxAttempts: 1,
      networkTimeout: 30000,
      throttleMs: 1000,
      ...config
    };
    this.visitedHosts = new Set();
  }

  /**
   * Detects if a page contains a login form and attempts to authenticate if found
   */
  async handleAuthentication(page: Page): Promise<AuthResult> {
    const interactions: string[] = [];
    const hostname = new URL(page.url()).hostname;

    // Skip if we've already tried this host
    if (this.visitedHosts.has(hostname)) {
      return { success: false, interactions: ['Host already attempted'] };
    }

    try {
      // Detect login form
      const loginForm = await this.detectLoginForm(page);
      if (!loginForm) {
        return { success: false, interactions: ['No login form detected'] };
      }

      interactions.push(`Login form detected: ${loginForm.formElement}`);

      // Mark host as visited
      this.visitedHosts.add(hostname);

      // Attempt login
      const success = await this.attemptLogin(page, loginForm);
      if (success) {
        interactions.push('Login successful');
        return { success: true, interactions };
      } else {
        interactions.push('Login failed');
        return { success: false, interactions };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Authentication failed', { error });
      return {
        success: false,
        error: errorMessage,
        interactions: [...interactions, `Authentication error: ${errorMessage}`]
      };
    }
  }

  /**
   * Detects login form and extracts relevant selectors
   */
  private async detectLoginForm(page: Page): Promise<LoginForm | null> {
    for (const formSelector of AuthEngine.LOGIN_SELECTORS.forms) {
      const form = await page.locator(formSelector).first();
      if (!await form.isVisible()) continue;

      // Find username input
      let usernameInput = null;
      for (const selector of AuthEngine.LOGIN_SELECTORS.usernameInputs) {
        const input = await form.locator(selector).first();
        if (await input.isVisible()) {
          usernameInput = selector;
          break;
        }
      }

      // Find password input
      let passwordInput = null;
      for (const selector of AuthEngine.LOGIN_SELECTORS.passwordInputs) {
        const input = await form.locator(selector).first();
        if (await input.isVisible()) {
          passwordInput = selector;
          break;
        }
      }

      // Find submit button
      let submitButton = null;
      for (const selector of AuthEngine.LOGIN_SELECTORS.submitButtons) {
        const button = await form.locator(selector).first();
        if (await button.isVisible()) {
          submitButton = selector;
          break;
        }
      }

      // Only proceed if we found all required elements
      if (usernameInput && passwordInput && submitButton) {
        // Look for CSRF token
        let csrfToken: string | undefined;
        for (const selector of AuthEngine.LOGIN_SELECTORS.csrfTokens) {
          const token = await page.locator(selector).first();
          if (await token.isVisible()) {
            const content = await token.getAttribute('content');
            const value = await token.getAttribute('value');
            csrfToken = content || value || undefined;
            if (csrfToken) break;
          }
        }

        return {
          formElement: formSelector,
          usernameInput,
          passwordInput,
          submitButton,
          ...(csrfToken && { csrfToken })
        };
      }
    }

    return null;
  }

  /**
   * Attempts to log in using the detected form
   */
  private async attemptLogin(page: Page, loginForm: LoginForm): Promise<boolean> {
    try {
      // Fill username
      await page.locator(loginForm.usernameInput).fill(this.config.username);
      await page.waitForTimeout(this.config.throttleMs);

      // Fill password
      await page.locator(loginForm.passwordInput).fill(this.config.password);
      await page.waitForTimeout(this.config.throttleMs);

      // Click submit and wait for navigation
      await Promise.all([
        page.waitForNavigation({ timeout: this.config.networkTimeout }),
        page.locator(loginForm.submitButton).click()
      ]);

      // Wait for any error messages
      await page.waitForTimeout(1000);

      // Check if we're still on a login page
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        return false;
      }

      // Check for common error messages
      const errorSelectors = [
        'text="Invalid"',
        'text="Failed"',
        'text="Incorrect"',
        '[class*="error"]',
        '[class*="alert"]'
      ];

      for (const selector of errorSelectors) {
        const error = await page.locator(selector).first();
        if (await error.isVisible()) {
          return false;
        }
      }

      return true;

    } catch (error) {
      this.logger.error('Login attempt failed', { error });
      return false;
    }
  }
} 