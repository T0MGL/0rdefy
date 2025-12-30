/**
 * Application Configuration
 * 
 * Centralized configuration for environment variables and app-wide constants.
 */

const getApiUrl = () => {
    // Check for the environment variable first
    let apiUrl = import.meta.env.VITE_API_URL;

    // Fallback for local development (MacBook/Localhost)
    if (!apiUrl) {
        apiUrl = 'http://localhost:3001';
    }

    // Defensive: Ensure we don't have double /api/api/
    // Remove all trailing slashes and /api segments using regex
    let cleanBaseURL = apiUrl.trim();
    // Remove /api (case insensitive) and trailing slashes repeatedly at the end
    cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
    cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');

    return cleanBaseURL;
};

export const config = {
    api: {
        baseUrl: getApiUrl(),
    },
};
