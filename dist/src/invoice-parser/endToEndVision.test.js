"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const index_1 = require("./index");
(0, node_test_1.default)('isVisionConfigured returns true for OpenAI vision models with API key', () => {
    const gpt4oConfig = {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: 'sk-test-key',
            nvidia: '',
            gemini: '',
            anthropic: '',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(gpt4oConfig), true);
    const gpt4oMiniConfig = {
        ...gpt4oConfig,
        model: 'gpt-4o-mini',
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(gpt4oMiniConfig), true);
});
(0, node_test_1.default)('isVisionConfigured returns false for text-only OpenAI models', () => {
    const o3MiniConfig = {
        enabled: true,
        provider: 'openai',
        model: 'o3-mini',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: 'sk-test-key',
            nvidia: '',
            gemini: '',
            anthropic: '',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(o3MiniConfig), false);
});
(0, node_test_1.default)('isVisionConfigured returns true for NVIDIA vision models', () => {
    const gemmaConfig = {
        enabled: true,
        provider: 'nvidia',
        model: 'google/gemma-4-31b-it',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: '',
            nvidia: 'nvapi-test-key',
            gemini: '',
            anthropic: '',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(gemmaConfig), true);
});
(0, node_test_1.default)('isVisionConfigured returns true for Claude and Gemini vision models with keys', () => {
    const claudeConfig = {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: '',
            nvidia: '',
            gemini: '',
            anthropic: 'sk-ant-test-key',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(claudeConfig), true);
    const geminiConfig = {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: '',
            nvidia: '',
            gemini: 'AIzaSy-test-key',
            anthropic: '',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(geminiConfig), true);
});
(0, node_test_1.default)('isVisionConfigured returns false when disabled or missing credentials', () => {
    const disabledConfig = {
        enabled: false,
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: 'sk-test-key',
            nvidia: '',
            gemini: '',
            anthropic: '',
            openrouter: '',
        },
    };
    strict_1.default.equal((0, index_1.isVisionConfigured)(disabledConfig), false);
    const missingKeyConfig = {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: '',
        confidenceThreshold: 0.75,
        maxImages: 4,
        apiKeys: {
            openai: '',
            nvidia: '',
            gemini: '',
            anthropic: '',
            openrouter: '',
        },
    };
    const prevEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        strict_1.default.equal((0, index_1.isVisionConfigured)(missingKeyConfig), false);
    }
    finally {
        if (prevEnv)
            process.env.OPENAI_API_KEY = prevEnv;
    }
});
