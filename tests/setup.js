import { beforeEach } from 'vitest';

// Setup global browser APIs that might not be available in test environment
beforeEach(() => {
    // Ensure localStorage is available
    if (typeof localStorage === 'undefined') {
        global.localStorage = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        };
    }

    // Ensure sessionStorage is available
    if (typeof sessionStorage === 'undefined') {
        global.sessionStorage = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        };
    }
});
