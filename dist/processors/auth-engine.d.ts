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
export declare class AuthEngine {
    private readonly logger;
    private readonly config;
    private readonly visitedHosts;
    private static readonly LOGIN_SELECTORS;
    constructor(logger: Logger, config?: Partial<AuthConfig>);
    /**
     * Detects if a page contains a login form and attempts to authenticate if found
     */
    handleAuthentication(page: Page): Promise<AuthResult>;
    /**
     * Detects login form and extracts relevant selectors
     */
    private detectLoginForm;
    /**
     * Attempts to log in using the detected form
     */
    private attemptLogin;
}
//# sourceMappingURL=auth-engine.d.ts.map