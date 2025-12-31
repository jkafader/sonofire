import { PubSub } from '../../lib/pubsub.js';
import { initDefaults } from '../../lib/init_defaults.js';
import { WhippableParametersMixin } from '../../lib/mixins/whippable_parameters.js';

/**
 * Base class for all Sonofire web components
 * Provides common lifecycle management, PubSub integration, and attribute handling
 */
class SonofireBaseCore extends HTMLElement {
    constructor() {
        super();

        // Component state
        this.config = {};
        this.subscriptions = []; // Track PubSub subscriptions for cleanup
        this.subscriptionsSetup = false; // Prevent duplicate subscriptions
        this.root = null; // DOM container (could be shadow root or this)
        // Note: this.isConnected is a built-in read-only property, don't override it
    }

    /**
     * Specify which attributes to observe for changes
     * Subclasses should override and call super.observedAttributes
     */
    static get observedAttributes() {
        return ['data-config', 'data-enabled', 'data-channel'];
    }

    /**
     * Called when component is added to the DOM
     */
    connectedCallback() {
        // Note: this.isConnected is automatically set by the browser

        // Initialize defaults on first component load
        initDefaults();

        // Set root to this element (subclasses can override to use shadow DOM)
        if (!this.root) {
            this.root = this;
        }

        // Parse initial attributes
        this.parseAttributes();

        // Setup PubSub subscriptions (only once)
        if (!this.subscriptionsSetup) {
            this.setupSubscriptions();
            this.subscriptionsSetup = true;
        }

        // Render component
        this.render();
    }

    /**
     * Called when component is removed from the DOM
     */
    disconnectedCallback() {
        // Note: this.isConnected is automatically set by the browser

        // Cleanup PubSub subscriptions
        this.cleanup();
    }

    /**
     * Called when an observed attribute changes
     */
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) {
            return;
        }

        this.handleAttributeChange(name, oldValue, newValue);
    }

    /**
     * Parse component attributes into config
     * Subclasses can override to add custom attribute parsing
     */
    parseAttributes() {
        // Parse data-config JSON
        const configAttr = this.getAttribute('data-config');
        if (configAttr) {
            try {
                this.config = JSON.parse(configAttr);
            } catch (err) {
                console.error('Failed to parse data-config:', err);
                this.config = {};
            }
        }

        // Parse common attributes
        this.enabled = this.getAttribute('data-enabled') !== 'false'; // Default true
        this.channel = parseInt(this.getAttribute('data-channel')) || 0;
    }

    /**
     * Handle attribute changes
     * Subclasses can override to add custom handling
     */
    handleAttributeChange(name, oldValue, newValue) {
        if (name === 'data-config') {
            try {
                this.config = JSON.parse(newValue);
                if (this.isConnected) {
                    this.render();
                }
            } catch (err) {
                console.error('Failed to parse data-config:', err);
            }
        } else if (name === 'data-enabled') {
            this.enabled = newValue !== 'false';
        } else if (name === 'data-channel') {
            this.channel = parseInt(newValue) || 0;
        }
    }

    /**
     * Setup PubSub subscriptions
     * Subclasses should override to add their subscriptions
     */
    setupSubscriptions() {
        // Base class has no subscriptions
        // Subclasses override and add their own
    }

    /**
     * Subscribe to a PubSub topic with automatic cleanup tracking
     * @param {string} topic - PubSub topic
     * @param {Function} callback - Callback function
     */
    subscribe(topic, callback) {
        PubSub.subscribe(topic, callback, this);

        // Track for cleanup (store callback hash)
        this.subscriptions.push({ topic, callback });
    }

    /**
     * Publish to a PubSub topic
     * @param {string} topic - PubSub topic
     * @param {Object} data - Event data
     */
    publish(topic, data) {
        PubSub.publish(topic, data);
    }

    /**
     * Get last published value for a topic
     * @param {string} topic - PubSub topic
     * @returns {*} Last published value or undefined
     */
    getLastValue(topic) {
        return PubSub.last(topic);
    }

    /**
     * Render the component
     * Subclasses should override
     */
    render() {
        // Base class does nothing
        // Subclasses implement their rendering
    }

    /**
     * Cleanup subscriptions and resources
     * Subclasses can override to add additional cleanup
     */
    cleanup() {
        // Reset subscription flag so component can re-subscribe if reconnected
        this.subscriptionsSetup = false;

        // Clear subscription tracking
        // Note: The existing pubsub.js doesn't have a way to unsubscribe individual callbacks
        // The callbacks will simply fail silently if called after the component is removed
        // because the context (this) will be disconnected
        this.subscriptions = [];
    }

    /**
     * Helper: Create a DOM element with attributes
     * @param {string} tag - Element tag name
     * @param {Object} attrs - Attributes object
     * @param {string|Array} children - Child elements or text
     * @returns {HTMLElement}
     */
    createElement(tag, attrs = {}, children = null) {
        const element = document.createElement(tag);

        // Set attributes
        Object.keys(attrs).forEach(key => {
            if (key === 'className') {
                element.className = attrs[key];
            } else if (key.startsWith('on')) {
                // Event listener
                const eventName = key.substring(2).toLowerCase();
                element.addEventListener(eventName, attrs[key]);
            } else {
                element.setAttribute(key, attrs[key]);
            }
        });

        // Add children
        if (children) {
            if (typeof children === 'string') {
                element.textContent = children;
            } else if (Array.isArray(children)) {
                children.forEach(child => {
                    if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    } else if (child instanceof HTMLElement) {
                        element.appendChild(child);
                    }
                });
            } else if (children instanceof HTMLElement) {
                element.appendChild(children);
            }
        }

        return element;
    }

    /**
     * Helper: Query selector within component root
     * @param {string} selector - CSS selector
     * @returns {Element}
     */
    $(selector) {
        return this.root.querySelector(selector);
    }

    /**
     * Helper: Query selector all within component root
     * @param {string} selector - CSS selector
     * @returns {NodeList}
     */
    $$(selector) {
        return this.root.querySelectorAll(selector);
    }
}

// Apply WhippableParametersMixin to the base class
export const SonofireBase = WhippableParametersMixin(SonofireBaseCore);
